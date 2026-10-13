//! Repositories the user includes in or excludes from searches.

use serde::Serialize;
use ts_rs::TS;

use crate::api_client::{Client, Error, Result};
use crate::rest::API_URL;

/// GitHub rejects longer search queries.
const MAX_QUERY_CHARS: usize = 256;

/// What a filter entry matches.
#[derive(Debug, Serialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "scope.ts")]
pub enum EntryKind {
    /// Every repository of a user or organization
    Owner,
    Repository,
}

impl Client {
    /// Checks a filter entry against GitHub, unknown owners and repositories are errors.
    pub async fn check_scope_entry(&self, entry: &str) -> Result<EntryKind> {
        let (url, kind, missing) = match entry.split_once('/') {
            Some(_) => (
                format!("{API_URL}repos/{entry}"),
                EntryKind::Repository,
                format!("No repository {entry}"),
            ),
            None => (
                format!("{API_URL}users/{entry}"),
                EntryKind::Owner,
                format!("No user or organization {entry}"),
            ),
        };

        let req = self.http.get(url);

        if let Err(err) = self.do_request(req).await {
            match err {
                Error::ResourceNotFound => {
                    return Err(Error::BadRequest(missing));
                }
                _ => {
                    return Err(err);
                }
            }
        }

        Ok(kind)
    }
}

/// Entries are `owner/repo`, or a bare `owner` for all of its repositories.
#[derive(Debug, Clone, Default)]
pub struct SearchScope {
    pub include: Vec<String>,
    pub exclude: Vec<String>,
}

/// `user:` matches organizations as well as personal accounts.
fn qualifier(entry: &str) -> String {
    if entry.contains('/') {
        return format!("repo:{entry}");
    }

    format!("user:{entry}")
}

fn matches(entry: &str, owner: &str, repo: &str) -> bool {
    match entry.split_once('/') {
        Some((o, r)) => o.eq_ignore_ascii_case(owner) && r.eq_ignore_ascii_case(repo),
        None => entry.eq_ignore_ascii_case(owner),
    }
}

fn fits(query: &str) -> bool {
    query.chars().count() <= MAX_QUERY_CHARS
}

impl SearchScope {
    /// Whether results from this repository are kept.
    pub fn allows(&self, owner: &str, repo: &str) -> bool {
        let included =
            self.include.is_empty() || self.include.iter().any(|e| matches(e, owner, repo));

        included && !self.exclude.iter().any(|e| matches(e, owner, repo))
    }

    /// `base` narrowed to the scope. Left as is when that would exceed GitHub's limit,
    /// results then only go through `allows`.
    pub fn narrow(&self, base: &str) -> String {
        let included = self.include.iter().map(|e| qualifier(e));
        let excluded = self.exclude.iter().map(|e| format!("-{}", qualifier(e)));
        let query = std::iter::once(base.to_string())
            .chain(included)
            .chain(excluded)
            .collect::<Vec<_>>()
            .join(" ");

        if !fits(&query) {
            return base.to_string();
        }

        query
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(include: &[&str], exclude: &[&str]) -> SearchScope {
        SearchScope {
            include: include.iter().map(|s| s.to_string()).collect(),
            exclude: exclude.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn allows_everything_by_default() {
        assert!(SearchScope::default().allows("collibra", "frontend"));
    }

    #[test]
    fn include_owner_or_repo_and_exclude_wins() {
        let s = scope(
            &["collibra", "fkhadra/react-contexify"],
            &["collibra/legacy"],
        );

        assert!(s.allows("Collibra", "frontend"));
        assert!(s.allows("fkhadra", "react-contexify"));
        assert!(!s.allows("fkhadra", "other"));
        assert!(!s.allows("collibra", "legacy"));
    }

    #[test]
    fn narrow_adds_qualifiers() {
        let s = scope(&["collibra", "a/b"], &["collibra/legacy"]);

        assert_eq!(
            s.narrow("is:pr"),
            "is:pr user:collibra repo:a/b -repo:collibra/legacy"
        );
    }

    #[test]
    fn narrow_keeps_base_when_too_long() {
        let repos: Vec<String> = (0..40).map(|i| format!("owner/repository-{i}")).collect();
        let s = SearchScope {
            include: repos,
            exclude: vec![],
        };

        assert_eq!(s.narrow("is:pr"), "is:pr");
    }
}
