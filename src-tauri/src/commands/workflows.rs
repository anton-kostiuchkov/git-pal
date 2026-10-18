use tauri::State;

use crate::core::AppState;

use git_pal_github::rest::{
    DispatchableWorkflow, FileRequest, FindWorkflowsRequest, RestResponse, RunWorkflowRequest,
    WorkflowInputs, WorkflowRun, Workflows,
};

use super::Result;

#[tauri::command]
pub async fn find_workflows(
    state: State<'_, AppState>,
    params: FindWorkflowsRequest<'_>,
) -> Result<RestResponse<Workflows>> {
    let res = state.github_client.find_workflows(params).await?;

    Ok(res)
}

#[tauri::command]
pub async fn find_dispatchable_workflows(
    state: State<'_, AppState>,
    params: FindWorkflowsRequest<'_>,
) -> Result<Vec<DispatchableWorkflow>> {
    let res = state
        .github_client
        .find_dispatchable_workflows(params)
        .await?;

    Ok(res)
}

#[tauri::command]
pub async fn find_active_runs(
    state: State<'_, AppState>,
    params: FindWorkflowsRequest<'_>,
) -> Result<Vec<WorkflowRun>> {
    let res = state.github_client.find_active_runs(params).await?;

    Ok(res)
}

#[tauri::command]
pub async fn extract_workflow_variables(
    state: State<'_, AppState>,
    params: FileRequest<'_>,
) -> Result<RestResponse<WorkflowInputs>> {
    let res = state
        .github_client
        .extract_workflow_variables(params)
        .await?;

    Ok(res)
}

#[tauri::command]
pub async fn run_workflow(
    state: State<'_, AppState>,
    params: RunWorkflowRequest<'_>,
) -> Result<()> {
    state.github_client.run_workflow(params).await?;

    Ok(())
}
