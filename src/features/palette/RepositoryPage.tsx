import { useSuspenseQuery } from "@tanstack/react-query";
import {
  BookOpenText,
  CircleDot,
  CirclePlay,
  GitMerge,
  GitPullRequestArrow,
  MessageCircleMore,
  PanelsTopLeft,
  Tag,
  Workflow,
} from "lucide-react";

import commands from "~/commands";
import { IconWrapper } from "~/components/icon-wrapper";
import { CommandGroup, CommandItem } from "~/components/ui/command";

import { RepositoryIcon } from "./Github/RepositoryIcon";
import { Container } from "./Layout";
import { state, useCurrentPage } from "./state";
import { openUrl } from "./utils";

export const REPOSITORY_PULL_REQUESTS = "page-repository-pull-requests";
const REPOSITORY_WORKFLOWS = "page-repository-workflows";
const REPOSITORY_MERGE_QUEUE = "page-repository-merge-queue";

function useRepositoryQuery() {
  const page = useCurrentPage("repository");

  return useSuspenseQuery({
    queryKey: ["repository", page.params.id],
    queryFn: async () => {
      const item = state.getItem(page.params.id);

      if (item?.kind !== "repo") return null;

      const repository = item.data;

      const params = {
        owner: repository.owner.login,
        repository: repository.name,
      };
      const [workflows, mergeQueue] = await Promise.all([
        commands.findWorkflows(params),
        commands.findMergeQueue(params),
      ]);

      return {
        repository,
        workflows,
        mergeQueue,
      };
    },
  });
}

function Count({ value }: { value: number | bigint }) {
  return <span className="ml-1 text-xs text-muted-foreground">({value})</span>;
}

export function RepositoryPage() {
  const { data } = useRepositoryQuery();

  if (!data) return;

  const { repository, workflows, mergeQueue } = data;

  return (
    <CommandGroup heading="Pages">
      <CommandItem
        value={`${repository.id}-home`}
        onSelect={() => {
          openUrl(repository.url);
        }}
      >
        <Container>
          <RepositoryIcon
            avatarUrl={repository.owner.avatarUrl}
            isPrivate={repository.isPrivate}
            isInOrganization={repository.isInOrganization}
          />
          <span>
            {repository.owner.login}/{repository.name}
          </span>
        </Container>
      </CommandItem>
      <CommandItem
        value={REPOSITORY_PULL_REQUESTS}
        onSelect={() => {
          state.goTo({
            to: "repository-pull-requests",
            params: {
              owner: repository.owner.login,
              repository: repository.name,
            },
          });
        }}
      >
        <Container>
          <IconWrapper>
            <GitPullRequestArrow className="text-info" />
          </IconWrapper>
          <div>
            Pull Requests
            <Count value={repository.pullRequests.totalCount} />
          </div>
        </Container>
      </CommandItem>
      {mergeQueue && (
        <CommandItem
          value={REPOSITORY_MERGE_QUEUE}
          onSelect={() => {
            state.goTo({
              to: "repository-merge-queue",
              params: { id: repository.id },
            });
          }}
        >
          <Container>
            <IconWrapper>
              <GitMerge className="text-success" />
            </IconWrapper>
            <div>
              Merge Queue
              <Count value={mergeQueue.entries?.totalCount ?? 0} />
            </div>
          </Container>
        </CommandItem>
      )}
      {repository.hasIssuesEnabled && (
        <CommandItem
          value={`${repository.id}-issues`}
          onSelect={() => {
            openUrl(`${repository.url}/issues`);
          }}
        >
          <Container>
            <IconWrapper>
              <CircleDot className="text-warning" />
            </IconWrapper>
            <div>
              Issues
              <Count value={repository.issues.totalCount} />
            </div>
          </Container>
        </CommandItem>
      )}
      {repository.hasDiscussionsEnabled && (
        <CommandItem
          value={`${repository.id}-discussions`}
          onSelect={() => {
            openUrl(`${repository.url}/discussions`);
          }}
        >
          <Container>
            <IconWrapper>
              <MessageCircleMore className="text-brand-alt" />
            </IconWrapper>
            <div>
              Discussions
              <Count value={repository.discussions.totalCount} />
            </div>
          </Container>
        </CommandItem>
      )}
      {repository.hasProjectsEnabled && (
        <CommandItem
          value={`${repository.id}-project`}
          onSelect={() => {
            openUrl(`${repository.url}/projects`);
          }}
        >
          <Container>
            <IconWrapper>
              <PanelsTopLeft className="text-teal-500" />
            </IconWrapper>
            <div>Project</div>
          </Container>
        </CommandItem>
      )}
      {repository.hasWikiEnabled && (
        <CommandItem
          value={`${repository.id}-wiki`}
          onSelect={() => {
            openUrl(`${repository.url}/wiki`);
          }}
        >
          <Container>
            <IconWrapper>
              <BookOpenText className="text-info" />
            </IconWrapper>
            <div>Wiki</div>
          </Container>
        </CommandItem>
      )}
      <CommandItem
        value={`${repository.id}-actions`}
        onSelect={() => {
          openUrl(`${repository.url}/actions`);
        }}
      >
        <Container>
          <IconWrapper>
            <CirclePlay className="text-success" />
          </IconWrapper>
          <div>Actions</div>
        </Container>
      </CommandItem>
      {workflows.data.total_count > 0 && (
        <CommandItem
          value={REPOSITORY_WORKFLOWS}
          onSelect={() => {
            state.goTo({
              to: "repository-workflows",
              params: { id: repository.id },
            });
          }}
        >
          <Container>
            <IconWrapper>
              <Workflow className="text-warning" />
            </IconWrapper>
            <div>Workflows</div>
          </Container>
        </CommandItem>
      )}
      <CommandItem
        value={`${repository.id}-releases`}
        onSelect={() => {
          openUrl(`${repository.url}/releases`);
        }}
      >
        <Container>
          <IconWrapper>
            <Tag className="text-agent" />
          </IconWrapper>
          <div>Releases</div>
        </Container>
      </CommandItem>
    </CommandGroup>
  );
}
