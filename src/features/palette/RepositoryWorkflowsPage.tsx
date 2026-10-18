import { useSuspenseQueries } from "@tanstack/react-query";
import { Clock, Workflow } from "lucide-react";
import { useState } from "react";

import commands from "~/commands";
import { Spinner } from "~/components/spinner";
import { CommandGroup, CommandItem } from "~/components/ui/command";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import type { DispatchableWorkflow, Repository } from "~/models";

import { Page } from "./Github";
import { RunWorkflowDialog } from "./RunWorkflowDialog";
import { state, useCurrentPage } from "./state";
import { openUrl } from "./utils";

const ACTIVE_RUNS_REFRESH_MS = 10_000;
// workflows rarely change, each fetch downloads every workflow file
const WORKFLOWS_CACHE_MS = 30 * 60_000;
const IN_PROGRESS = "in_progress";

function useWorkflowsQueries(repository: Repository) {
  const params = {
    owner: repository.owner.login,
    repository: repository.name,
  };

  return useSuspenseQueries({
    queries: [
      {
        queryKey: ["dispatchable-workflows", params.owner, params.repository],
        queryFn: () => commands.findDispatchableWorkflows(params),
        staleTime: WORKFLOWS_CACHE_MS,
        gcTime: WORKFLOWS_CACHE_MS,
      },
      {
        queryKey: ["active-runs", params.owner, params.repository],
        queryFn: () => commands.findActiveRuns(params),
        refetchInterval: ACTIVE_RUNS_REFRESH_MS,
      },
    ],
  });
}

function RunIcon({ status }: { status: string | null }) {
  if (status === IN_PROGRESS) {
    return <Spinner className="size-4 text-warning" />;
  }

  return <Clock className="text-muted-foreground" />;
}

function NoWorkflows() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Workflow />
        </EmptyMedia>
        <EmptyTitle>No workflows to run</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function Workflows({ repository }: { repository: Repository }) {
  const [{ data: workflows }, { data: runs }] = useWorkflowsQueries(repository);
  const [selected, setSelected] = useState<DispatchableWorkflow | null>(null);
  // kept apart from `selected`, the closing dialog still shows the workflow
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  if (workflows.length === 0 && runs.length === 0) {
    return <NoWorkflows />;
  }

  return (
    <>
      {runs.length > 0 && (
        <CommandGroup heading="My Running Workflows">
          {runs.map((run) => (
            <CommandItem
              key={run.html_url}
              value={run.html_url}
              keywords={[run.display_title, run.name ?? ""]}
              onSelect={() => openUrl(run.html_url)}
            >
              <Page icon={<RunIcon status={run.status} />}>
                {run.display_title}
                <span className="ml-2 text-xs text-muted-foreground group-data-[selected=true]:text-primary-foreground/80">
                  {[run.name, run.head_branch].filter(Boolean).join(" · ")}
                </span>
              </Page>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      <CommandGroup heading="Workflows">
        {workflows.map((v) => (
          <CommandItem
            key={v.workflow.id}
            value={`workflow-${v.workflow.id}`}
            keywords={[v.workflow.name]}
            onSelect={() => {
              setSelected(v);
              setIsDialogOpen(true);
            }}
          >
            <Page icon={<Workflow className="text-warning" />}>
              {v.workflow.name}
            </Page>
          </CommandItem>
        ))}
      </CommandGroup>
      <RunWorkflowDialog
        repository={repository}
        workflow={selected}
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
      />
    </>
  );
}

export function RepositoryWorkflowsPage() {
  const { params } = useCurrentPage("repository-workflows");
  const item = state.getItem(params.id);

  if (item?.kind !== "repo") return null;

  return <Workflows repository={item.data} />;
}
