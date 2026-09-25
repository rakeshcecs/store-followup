"use client";

import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useErrorMessage } from "@/hooks/use-error-message";
import { IMPORT_MAX_BYTES } from "@/lib/import/types";

type Option = { value: string; label: string };

// Branch + file → the preview. Posted to a route handler (a Server Action caps the body
// at 1 MB); the server reads and checks the file and answers with the preview's id.
export function UploadForm({
  branches,
  defaultBranch,
}: {
  branches: Option[];
  defaultBranch: string;
}) {
  const t = useTranslations("import");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [branchId, setBranchId] = useState(defaultBranch);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      setError(tError("import.errors.tooBig"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const body = new FormData();
      body.set("file", file);
      body.set("branchId", branchId);
      const response = await fetch("/import/upload", { method: "POST", body }).catch(() => null);
      const result = (await response?.json().catch(() => null)) as
        { ok: true; jobId: string } | { ok: false; error: string } | null;
      if (!result) {
        setError(tError("errors.internal"));
        return;
      }
      if (!result.ok) {
        setError(tError(result.error));
        return;
      }
      router.push(`/import/${result.jobId}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="upload-form">
      <Select
        name="branchId"
        label={t("branch")}
        options={branches}
        value={branchId}
        disabled={pending || branches.length < 2}
        onChange={(event) => setBranchId(event.target.value)}
      />
      <label className="flex flex-col gap-1.5 text-[15px] font-bold">
        {t("file")}
        <input
          type="file"
          name="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          disabled={pending}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
          className="rounded-lg border-[1.5px] border-input bg-card p-3 text-[15px] font-normal"
        />
      </label>
      {error && (
        <p role="alert" className="text-[15px] text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!file || pending}>
        <Upload aria-hidden />
        {pending ? t("checking") : t("check")}
      </Button>
    </form>
  );
}
