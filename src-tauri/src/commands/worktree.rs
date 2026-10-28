use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    core::{AppState, Event, emit_event},
    editor,
};

use git_pal_code_review::{git, models::GetSavedReviewRequest};

use super::Result;

/// Returns the PR worktree, creating it when missing.
async fn ensure_worktree(
    app: &AppHandle,
    request: GetSavedReviewRequest,
) -> anyhow::Result<std::path::PathBuf> {
    let repositories_dir = app.state::<AppState>().repositories_dir();
    let app = app.clone();

    tokio::task::spawn_blocking(move || {
        let GetSavedReviewRequest {
            owner,
            repository,
            pr_number,
        } = request;
        let dir = git::worktree_dir(&repositories_dir, &owner, &repository, pr_number);
        if dir.join(".git").exists() {
            return Ok(dir);
        }

        let dir = git::prepare_worktree(&repositories_dir, &owner, &repository, pr_number)?;
        emit_event(&app, Event::WorktreesChanged);

        Ok(dir)
    })
    .await?
}

#[tauri::command]
pub async fn worktree_path(app: AppHandle, request: GetSavedReviewRequest) -> Result<String> {
    let dir = ensure_worktree(&app, request).await?;

    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn is_repository_cloned(state: State<'_, AppState>, owner: String, repository: String) -> bool {
    git::is_cloned(&state.repositories_dir(), &owner, &repository)
}

#[tauri::command]
pub async fn worktrees_size(state: State<'_, AppState>) -> Result<u64> {
    let repositories_dir = state.repositories_dir();
    let size = tokio::task::spawn_blocking(move || git::worktrees_size(&repositories_dir))
        .await
        .map_err(anyhow::Error::from)?;

    Ok(size)
}

/// Shows the folder holding the worktrees in the OS file manager.
#[tauri::command]
pub fn open_repositories_dir(app: AppHandle) -> Result<()> {
    let dir = app.state::<AppState>().repositories_dir();
    std::fs::create_dir_all(&dir).map_err(anyhow::Error::from)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(anyhow::Error::from)?;

    Ok(())
}

#[tauri::command]
pub fn list_editors() -> Vec<String> {
    editor::installed()
}

#[tauri::command]
pub async fn open_in_editor(
    app: AppHandle,
    request: GetSavedReviewRequest,
    editor: String,
) -> Result<()> {
    let dir = ensure_worktree(&app, request).await?;
    editor::open(&editor, &dir)?;

    Ok(())
}
