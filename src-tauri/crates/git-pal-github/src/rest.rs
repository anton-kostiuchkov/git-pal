use std::collections::HashMap;
use std::fmt::Debug;

use futures_util::future::join_all;
use reqwest::RequestBuilder;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use url::Url;

use crate::api_client::{Client, Error, Response, Result};
use crate::attachments::sign_attachments;
use crate::conversation::truncate;
use crate::github::Metadata;

pub(crate) const API_URL: &str = "https://api.github.com/";

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "api.ts")]
pub struct RestResponse<T> {
    pub metadata: Metadata,
    pub data: T,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "rest.ts")]
pub struct Workflow {
    pub id: i32,
    pub node_id: String,
    pub name: String,
    pub path: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
    pub html_url: String,
    pub badge_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "rest.ts")]
pub struct Workflows {
    pub total_count: i32,
    pub workflows: Vec<Workflow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "rest.ts")]
pub struct WorkflowInput {
    pub name: Option<String>,
    pub description: Option<String>,
    #[serde(default, deserialize_with = "scalar_string")]
    pub default: Option<String>,
    pub required: Option<bool>,
    #[serde(rename = "type")]
    pub input_type: Option<String>,
    /// Values of a `choice` input
    #[serde(default, deserialize_with = "scalar_strings")]
    pub options: Option<Vec<String>>,
}

pub type WorkflowInputs = Vec<WorkflowInput>;

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export, export_to = "rest.ts")]
pub struct DispatchableWorkflow {
    pub workflow: Workflow,
    pub inputs: WorkflowInputs,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "rest.ts")]
pub struct WorkflowRun {
    pub name: Option<String>,
    pub display_title: String,
    pub status: Option<String>,
    pub head_branch: Option<String>,
    pub html_url: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize, Clone)]
struct WorkflowRuns {
    workflow_runs: Vec<WorkflowRun>,
}

const ACTIVE_WORKFLOW: &str = "active";
const DISPATCH_EVENT: &str = "workflow_dispatch";
/// Statuses of a run not finished yet
const ACTIVE_RUN_STATUSES: [&str; 3] = ["queued", "in_progress", "waiting"];

#[derive(Debug, Deserialize)]
struct WorkflowFile {
    on: WorkflowEvents,
}

/// `on` holds an event name, a list of names or a map of triggers.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum WorkflowEvents {
    Name(String),
    Names(Vec<String>),
    Triggers(serde_yaml::Mapping),
}

#[derive(Debug, Default, Deserialize)]
struct WorkflowTrigger {
    inputs: Option<serde_yaml::Mapping>,
}

impl WorkflowEvents {
    /// `None` when the workflow can't be run manually.
    fn dispatch_trigger(self) -> Option<WorkflowTrigger> {
        match self {
            WorkflowEvents::Name(name) => (name == DISPATCH_EVENT).then(WorkflowTrigger::default),
            WorkflowEvents::Names(names) => names
                .iter()
                .any(|name| name == DISPATCH_EVENT)
                .then(WorkflowTrigger::default),
            WorkflowEvents::Triggers(mut triggers) => {
                let trigger = triggers.remove(DISPATCH_EVENT)?;

                // `workflow_dispatch:` alone is null
                if trigger.is_null() {
                    return Some(WorkflowTrigger::default());
                }

                serde_yaml::from_value(trigger).ok()
            }
        }
    }
}

/// Keeps the YAML order, the form lists inputs like the workflow file.
fn workflow_inputs(trigger: WorkflowTrigger) -> Result<WorkflowInputs> {
    trigger
        .inputs
        .unwrap_or_default()
        .into_iter()
        .map(|(name, input)| {
            let input: WorkflowInput = serde_yaml::from_value(input)
                .map_err(|e| Error::InvalidWorkflowFile(e.to_string()))?;

            Ok(WorkflowInput {
                name: name.as_str().map(String::from),
                ..input
            })
        })
        .collect()
}

fn yaml_string(value: serde_yaml::Value) -> Option<String> {
    match value {
        serde_yaml::Value::String(value) => Some(value),
        serde_yaml::Value::Bool(value) => Some(value.to_string()),
        serde_yaml::Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

/// YAML scalars like `default: false` become text, the form edits text.
fn scalar_string<'de, D>(deserializer: D) -> std::result::Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_yaml::Value>::deserialize(deserializer)?;

    Ok(value.and_then(yaml_string))
}

fn scalar_strings<'de, D>(deserializer: D) -> std::result::Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let values = Option::<Vec<serde_yaml::Value>>::deserialize(deserializer)?;

    Ok(values.map(|values| values.into_iter().filter_map(yaml_string).collect()))
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "rest.ts")]
pub struct FileRequest<'a> {
    pub owner: &'a str,
    pub repository: &'a str,
    pub file_path: &'a str,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "rest.ts")]
pub struct FileSourceRequest {
    pub owner: String,
    pub repository: String,
    pub path: String,
    pub git_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "rest.ts")]
pub struct RunWorkflowRequest<'a> {
    pub owner: &'a str,
    pub repository: &'a str,
    pub workflow_id: i32,
    pub branch: &'a str,
    #[ts(type = "Record<string, any>")]
    pub variables: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "rest.ts")]
pub struct FindWorkflowsRequest<'a> {
    pub owner: &'a str,
    pub repository: &'a str,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "rest.ts")]
pub struct GetPullRequestRequest {
    pub owner: String,
    pub repository: String,
    pub number: i64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "rest.ts")]
pub struct PullRequestDetails {
    pub title: String,
    pub html_url: String,
    pub head_ref: String,
    pub head_sha: String,
    pub base_ref: String,
    /// Markdown description, `None` when left empty
    pub body: Option<String>,
    pub changed_files: i64,
    /// GitHub refuses its diff, it comes from a local clone instead
    pub is_diff_too_large: bool,
}

/// Bot descriptions (e.g. dependency updates) can be huge, prompts only need the gist.
const MAX_PROMPT_DESCRIPTION_CHARS: usize = 4000;

impl PullRequestDetails {
    /// The description sized for a prompt, empty when there is none.
    pub fn prompt_description(&self) -> String {
        self.body
            .as_deref()
            .map(|body| truncate(body, MAX_PROMPT_DESCRIPTION_CHARS))
            .unwrap_or_default()
    }
}

#[derive(Debug, Deserialize)]
struct PullRequestResponse {
    title: String,
    html_url: String,
    body: Option<String>,
    changed_files: i64,
    head: PullRequestHead,
    base: PullRequestBase,
}

pub(crate) const FULL_MEDIA_TYPE: &str = "application/vnd.github.full+json";

#[derive(Debug, Deserialize)]
struct DescriptionResponse {
    body: Option<String>,
    body_html: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PullRequestBase {
    #[serde(rename = "ref")]
    ref_field: String,
}

#[derive(Debug, Deserialize)]
struct PullRequestHead {
    #[serde(rename = "ref")]
    ref_field: String,
    sha: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "rest.ts")]
pub struct CompareCommitsRequest {
    pub owner: String,
    pub repository: String,
    pub base: String,
    pub head: String,
}

/// How head relates to base, `Diverged` once the history was rewritten.
#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "rest.ts")]
pub enum CompareStatus {
    Ahead,
    Behind,
    Diverged,
    Identical,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "rest.ts")]
pub struct CommitComparison {
    pub status: CompareStatus,
    pub ahead_by: i64,
}

#[derive(Debug, Deserialize)]
struct CompareResponse {
    status: CompareStatus,
    ahead_by: i64,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "rest.ts")]
pub struct PullRequestFile {
    pub sha: String,
    pub filename: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    pub changes: i64,
    pub patch: Option<String>,
    pub previous_filename: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "rest.ts")]
pub struct PullRequestDiff {
    pub files: Vec<PullRequestFile>,
    pub raw_diff: String,
    pub total_additions: i64,
    pub total_deletions: i64,
    pub total_files: i64,
}

impl PullRequestDiff {
    pub fn new(files: Vec<PullRequestFile>, raw_diff: String) -> Self {
        Self {
            total_additions: files.iter().map(|f| f.additions).sum(),
            total_deletions: files.iter().map(|f| f.deletions).sum(),
            total_files: files.len() as i64,
            files,
            raw_diff,
        }
    }
}

/// GitHub refuses the diff of a pull request changing more files.
const MAX_DIFF_FILES: i64 = 300;

const PER_PAGE: usize = 100;

/// Side of the diff a comment applies to, only the new version is supported.
const COMMENT_SIDE: &str = "RIGHT";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export, export_to = "rest.ts")]
pub enum ReviewEvent {
    Comment,
    Approve,
    RequestChanges,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "rest.ts")]
pub struct DraftReviewComment {
    pub path: String,
    pub body: String,
    /// `None` for a file level comment
    pub line: Option<u32>,
    pub start_line: Option<u32>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "rest.ts")]
pub struct SubmitReviewRequest {
    pub owner: String,
    pub repository: String,
    pub number: i64,
    /// Head commit the comment lines refer to
    pub commit_id: String,
    pub body: String,
    pub event: ReviewEvent,
    pub comments: Vec<DraftReviewComment>,
}

impl Client {
    pub async fn find_workflows(
        &self,
        FindWorkflowsRequest { owner, repository }: FindWorkflowsRequest<'_>,
    ) -> Result<RestResponse<Workflows>> {
        let req = self
            .http
            .get(format!(
                "{API_URL}repos/{owner}/{repository}/actions/workflows"
            ))
            .query(&[("per_page", PER_PAGE)]);

        self.send_request(req).await
    }

    /// Active workflows with a `workflow_dispatch` trigger.
    pub async fn find_dispatchable_workflows(
        &self,
        params: FindWorkflowsRequest<'_>,
    ) -> Result<Vec<DispatchableWorkflow>> {
        let FindWorkflowsRequest { owner, repository } = params;
        let res = self.find_workflows(params).await?;
        let workflows = res
            .data
            .workflows
            .into_iter()
            .filter(|workflow| workflow.state == ACTIVE_WORKFLOW);

        // only the workflow file tells if it can be dispatched
        let files = join_all(workflows.map(|workflow| async move {
            let file = FileRequest {
                owner,
                repository,
                file_path: &workflow.path,
            };
            let inputs = self.extract_workflow_variables(file).await;

            (workflow, inputs)
        }))
        .await;

        let mut dispatchable = Vec::new();

        for (workflow, inputs) in files {
            match inputs {
                Ok(inputs) => dispatchable.push(DispatchableWorkflow {
                    workflow,
                    inputs: inputs.data,
                }),
                // not dispatchable, or a GitHub managed workflow without file
                Err(Error::InvalidWorkflowFile(_) | Error::ResourceNotFound) => continue,
                Err(e) => return Err(e),
            }
        }

        Ok(dispatchable)
    }

    /// Runs triggered by the viewer, not finished yet.
    pub async fn find_active_runs(
        &self,
        FindWorkflowsRequest { owner, repository }: FindWorkflowsRequest<'_>,
    ) -> Result<Vec<WorkflowRun>> {
        let actor = self.with_user(|user| user.login.clone())?;

        // the endpoint filters a single status
        let responses = join_all(ACTIVE_RUN_STATUSES.map(|status| {
            let req = self
                .http
                .get(format!("{API_URL}repos/{owner}/{repository}/actions/runs"))
                .query(&[("actor", actor.as_str()), ("status", status)]);

            self.send_request::<WorkflowRuns>(req)
        }))
        .await;

        let mut runs = Vec::new();

        for res in responses {
            runs.extend(res?.data.workflow_runs);
        }

        // newest first, the timestamps are ISO 8601
        runs.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        Ok(runs)
    }

    pub async fn file(&self, params: FileRequest<'_>) -> Result<RestResponse<String>> {
        let req = self
            .http
            .get(format!(
                "{API_URL}repos/{owner}/{repository}/contents/{file_path}",
                owner = params.owner,
                repository = params.repository,
                file_path = params.file_path
            ))
            .header("Accept", "application/vnd.github.raw+json");

        let Response { metadata, response } = self.do_request(req).await?;
        let file_content = response.text().await?;

        Ok(RestResponse {
            metadata,
            data: file_content,
        })
    }

    pub async fn file_source(&self, request: &FileSourceRequest) -> Result<String> {
        let invalid_url = || Error::BadRequest(format!("invalid url {API_URL}"));
        let mut url = Url::parse(API_URL).map_err(|_| invalid_url())?;
        // segments are encoded, paths may hold spaces or emojis
        url.path_segments_mut()
            .map_err(|_| invalid_url())?
            .extend(["repos", &request.owner, &request.repository, "contents"])
            .extend(request.path.split('/'));

        let req = self
            .http
            .get(url)
            .query(&[("ref", &request.git_ref)])
            .header("Accept", "application/vnd.github.raw+json");

        let Response { response, .. } = self.do_request(req).await?;

        Ok(response.text().await?)
    }

    pub async fn extract_workflow_variables(
        &self,
        params: FileRequest<'_>,
    ) -> Result<RestResponse<WorkflowInputs>> {
        let res = self.file(params).await?;

        let workflow: WorkflowFile = serde_yaml::from_str(&res.data)
            .map_err(|e| Error::InvalidWorkflowFile(e.to_string()))?;

        let trigger = workflow.on.dispatch_trigger().ok_or_else(|| {
            Error::InvalidWorkflowFile(format!("{DISPATCH_EVENT} trigger missing"))
        })?;

        Ok(RestResponse {
            metadata: res.metadata,
            data: workflow_inputs(trigger)?,
        })
    }

    pub async fn run_workflow(&self, params: RunWorkflowRequest<'_>) -> Result<()> {
        #[derive(Debug, Serialize, Clone)]
        struct Body {
            #[serde(rename = "ref")]
            ref_field: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            inputs: Option<HashMap<String, serde_json::Value>>,
        }

        let req = self
            .http
            .post(format!(
                "{API_URL}repos/{owner}/{repository}/actions/workflows/{workflow_id}/dispatches",
                owner = params.owner,
                repository = params.repository,
                workflow_id = params.workflow_id
            ))
            .json(&Body {
                ref_field: params.branch.to_string(),
                inputs: params.variables,
            });

        let _ = self.do_request(req).await?;

        Ok(())
    }

    pub async fn get_pull_request(
        &self,
        request: &GetPullRequestRequest,
    ) -> Result<PullRequestDetails> {
        let req = self.http.get(pull_request_url(request));

        let Response { response, .. } = self.do_request(req).await?;
        let pr: PullRequestResponse = response.json().await?;

        Ok(PullRequestDetails {
            title: pr.title,
            html_url: pr.html_url,
            head_ref: pr.head.ref_field,
            head_sha: pr.head.sha,
            base_ref: pr.base.ref_field,
            body: pr.body,
            changed_files: pr.changed_files,
            is_diff_too_large: pr.changed_files > MAX_DIFF_FILES,
        })
    }

    pub async fn pull_request_description(
        &self,
        request: &GetPullRequestRequest,
    ) -> Result<Option<String>> {
        let req = self
            .http
            .get(pull_request_url(request))
            .header("Accept", FULL_MEDIA_TYPE);

        let Response { response, .. } = self.do_request(req).await?;
        let pr: DescriptionResponse = response.json().await?;
        let html = pr.body_html.unwrap_or_default();

        Ok(pr.body.map(|body| sign_attachments(&body, &html)))
    }

    pub async fn compare_commits(
        &self,
        request: &CompareCommitsRequest,
    ) -> Result<CommitComparison> {
        // the commit list isn't needed, only the counters
        let url = format!(
            "{API_URL}repos/{}/{}/compare/{}...{}?per_page=1",
            request.owner, request.repository, request.base, request.head
        );
        let req = self.http.get(url);
        let Response { response, .. } = self.do_request(req).await?;
        let comparison: CompareResponse = response.json().await?;

        Ok(CommitComparison {
            status: comparison.status,
            ahead_by: comparison.ahead_by,
        })
    }

    pub async fn get_pull_request_diff(
        &self,
        request: &GetPullRequestRequest,
    ) -> Result<PullRequestDiff> {
        let files = self.get_pull_request_files(request).await?;
        let raw_diff = self.get_pull_request_raw_diff(request).await?;

        Ok(PullRequestDiff::new(files, raw_diff))
    }

    pub async fn get_pull_request_files(
        &self,
        request: &GetPullRequestRequest,
    ) -> Result<Vec<PullRequestFile>> {
        self.get_all_pages(&format!("{}/files", pull_request_url(request)))
            .await
    }

    /// Follows GitHub's page based pagination until a partial page is returned.
    pub(crate) async fn get_all_pages<T: DeserializeOwned>(&self, url: &str) -> Result<Vec<T>> {
        self.get_all_pages_as(url, None).await
    }

    /// Every page of `url`, in the `accept` media type when given.
    pub(crate) async fn get_all_pages_as<T: DeserializeOwned>(
        &self,
        url: &str,
        accept: Option<&str>,
    ) -> Result<Vec<T>> {
        let mut items = Vec::new();
        let mut page = 1u32;

        loop {
            let mut req = self
                .http
                .get(format!("{url}?per_page={PER_PAGE}&page={page}"));

            if let Some(accept) = accept {
                req = req.header("Accept", accept);
            }

            let Response { response, .. } = self.do_request(req).await?;
            let batch: Vec<T> = response.json().await?;
            let is_last_page = batch.len() < PER_PAGE;
            items.extend(batch);

            if is_last_page {
                break;
            }
            page += 1;
        }

        Ok(items)
    }

    async fn get_pull_request_raw_diff(&self, request: &GetPullRequestRequest) -> Result<String> {
        let req = self
            .http
            .get(pull_request_url(request))
            .header("Accept", "application/vnd.github.diff");

        let Response { response, .. } = self.do_request(req).await?;

        Ok(response.text().await?)
    }

    /// Posts line comments as one review, file comments are posted alongside since reviews can't hold them.
    pub async fn submit_review(&self, request: &SubmitReviewRequest) -> Result<()> {
        let (line_comments, file_comments): (Vec<_>, Vec<_>) =
            request.comments.iter().partition(|c| c.line.is_some());

        let url = pull_request_url(&GetPullRequestRequest {
            owner: request.owner.clone(),
            repository: request.repository.clone(),
            number: request.number,
        });

        // GitHub rejects an empty comment review, file comments alone don't need one
        let is_empty = matches!(request.event, ReviewEvent::Comment)
            && request.body.trim().is_empty()
            && line_comments.is_empty();

        if !is_empty {
            let comments: Vec<serde_json::Value> = line_comments
                .iter()
                .map(|c| {
                    let mut comment = serde_json::json!({
                        "path": c.path,
                        "body": c.body,
                        "line": c.line,
                        "side": COMMENT_SIDE,
                    });
                    if let Some(start_line) = c.start_line {
                        comment["start_line"] = start_line.into();
                        comment["start_side"] = COMMENT_SIDE.into();
                    }
                    comment
                })
                .collect();

            let req = self
                .http
                .post(format!("{url}/reviews"))
                .json(&serde_json::json!({
                    "commit_id": request.commit_id,
                    "body": request.body,
                    "event": request.event,
                    "comments": comments,
                }));

            self.do_request(req).await?;
        }

        for comment in file_comments {
            let req = self
                .http
                .post(format!("{url}/comments"))
                .json(&serde_json::json!({
                    "commit_id": request.commit_id,
                    "path": comment.path,
                    "body": comment.body,
                    "subject_type": "file",
                }));

            self.do_request(req).await.map_err(|e| {
                Error::BadRequest(format!("file comment on {} failed: {e}", comment.path))
            })?;
        }

        Ok(())
    }

    async fn send_request<R>(&self, req: RequestBuilder) -> Result<RestResponse<R>>
    where
        R: DeserializeOwned + Clone + Debug,
    {
        let req = req.header("Accept", "application/vnd.github+json");
        let Response { metadata, response } = self.do_request(req).await?;
        let data: R = response.json().await?;

        Ok(RestResponse { metadata, data })
    }
}

pub(crate) fn pull_request_url(request: &GetPullRequestRequest) -> String {
    format!(
        "{API_URL}repos/{}/{}/pulls/{}",
        request.owner, request.repository, request.number
    )
}
