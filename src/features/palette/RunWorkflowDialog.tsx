import { Play } from "lucide-react";
import { Controller, useForm } from "react-hook-form";

import commands from "~/commands";
import { ErrorMessage, FormControl, Input, Label } from "~/components/form";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import type { DispatchableWorkflow, Repository, WorkflowInput } from "~/models";

import { openUrl } from "./utils";

const BOOLEAN_INPUT = "boolean";
const CHOICE_INPUT = "choice";
const NUMBER_INPUT = "number";
const ESCAPE_KEY = "Escape";

interface FormValues {
  branch: string;
  // by position, input names may hold dots react-hook-form reads as paths
  inputs: (string | boolean)[];
}

function defaultValue(input: WorkflowInput) {
  if (input.type === BOOLEAN_INPUT) return input.default === "true";

  if (input.type === CHOICE_INPUT) {
    return input.default ?? input.options?.[0] ?? "";
  }

  return input.default ?? "";
}

/** The workflow runs list, where the dispatched run shows up. */
function runsUrl(repository: Repository, { workflow }: DispatchableWorkflow) {
  const fileName = workflow.path.split("/").pop();

  return `${repository.url}/actions/workflows/${fileName}`;
}

interface FieldProps {
  label: string;
  hint?: string | null;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <FormControl>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{label}</Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </FormControl>
  );
}

interface FormProps {
  repository: Repository;
  workflow: DispatchableWorkflow;
}

function RunWorkflowForm({ repository, workflow }: FormProps) {
  const { register, control, handleSubmit, setError, formState } =
    useForm<FormValues>({
      defaultValues: {
        branch: repository.defaultBranchRef?.name ?? "",
        inputs: workflow.inputs.map(defaultValue),
      },
    });

  const onSubmit = handleSubmit(async (values) => {
    // GitHub reads every input as text
    const variables = Object.fromEntries(
      workflow.inputs.map((input, i) => [input.name, String(values.inputs[i])]),
    );

    try {
      await commands.runWorkflow({
        owner: repository.owner.login,
        repository: repository.name,
        workflow_id: workflow.workflow.id,
        branch: values.branch,
        variables,
      });
      openUrl(runsUrl(repository, workflow));
    } catch (error) {
      setError("root", { message: String(error) });
    }
  });

  const renderInput = (input: WorkflowInput, i: number) => {
    const name = `inputs.${i}` as const;
    const rules = { required: input.required ? "Required" : false };

    if (input.type === BOOLEAN_INPUT) {
      return (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <Switch
              checked={field.value === true}
              onCheckedChange={field.onChange}
            />
          )}
        />
      );
    }

    if (input.type === CHOICE_INPUT) {
      return (
        <Controller
          control={control}
          name={name}
          rules={rules}
          render={({ field }) => (
            <Select value={String(field.value)} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {input.options?.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      );
    }

    return (
      <Input
        inputMode={input.type === NUMBER_INPUT ? "decimal" : undefined}
        {...register(name, rules)}
        error={formState.errors.inputs?.[i]?.message}
      />
    );
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <Field label="Branch">
        <Input
          className="font-mono"
          {...register("branch", { required: "Branch is required" })}
          error={formState.errors.branch?.message}
        />
      </Field>

      {workflow.inputs.map((input, i) => (
        <Field
          key={input.name}
          label={input.name ?? ""}
          hint={input.description}
        >
          {renderInput(input, i)}
        </Field>
      ))}

      <ErrorMessage error={formState.errors.root?.message} />

      <Button
        type="submit"
        className="ml-auto"
        disabled={formState.isSubmitting}
      >
        <Play />
        Run
      </Button>
    </form>
  );
}

interface Props {
  repository: Repository;
  workflow: DispatchableWorkflow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RunWorkflowDialog({
  repository,
  workflow,
  open,
  onOpenChange,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] w-md overflow-y-auto"
        // cmdk would handle Enter and arrows, Escape must reach the dialog
        onKeyDown={(e) => {
          if (e.key !== ESCAPE_KEY) e.stopPropagation();
        }}
      >
        {workflow && (
          <>
            <DialogHeader>
              <DialogTitle>{workflow.workflow.name}</DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {workflow.workflow.path}
              </DialogDescription>
            </DialogHeader>
            <RunWorkflowForm
              key={workflow.workflow.id}
              repository={repository}
              workflow={workflow}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
