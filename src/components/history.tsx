"use client";
import {
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Clock3,
  TriangleAlert,
  CheckCheck,
} from "lucide-react";
import { useState } from "react";
import {
  batchStatus,
  platformNames,
  stateLabels,
  type BatchInfo,
} from "@/lib/domain";
import { PlatformIcon } from "./platform";
import { api } from "@/lib/client";
export default function History({
  batches,
  onRefresh,
  notify,
}: {
  batches: BatchInfo[];
  onRefresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [busy, setBusy] = useState("");
  async function retry(id: string) {
    setBusy(id);
    try {
      await api("jobs/" + id + "/retry", "POST");
      await onRefresh();
      notify("Tujuan gagal diantrekan kembali.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-intro">
        <span className="eyebrow">Publikasi</span>
        <h1>Setiap tujuan, terlihat.</h1>
        <p>
          Hasil diperbarui otomatis. Satu platform gagal tidak mengulang posting
          yang berhasil.
        </p>
      </div>
      {batches.length === 0 ? (
        <div className="empty-state">
          <Clock3 size={30} />
          <h2>Belum ada publikasi</h2>
          <p>Konten yang sudah dikonfirmasi akan muncul di sini.</p>
        </div>
      ) : (
        <div className="history-list">
          {batches.map((batch) => (
            <article key={batch.id} className="batch-card">
              <header>
                <div>
                  <h2>{batch.title}</h2>
                  <p>
                    {new Date(batch.createdAt).toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Jakarta",
                    })}{" "}
                    WIB
                  </p>
                </div>
                <span className="quiet-tag">{batchStatus(batch.jobs)}</span>
              </header>
              <div className="job-list">
                {batch.jobs.map((job) => (
                  <div className="job-row" key={job.id}>
                    <span className="job-icon">
                      <PlatformIcon platform={job.platform} size={21} />
                    </span>
                    <div className="job-copy">
                      <strong>
                        {platformNames[job.platform]}
                        <span>{job.accountLabel}</span>
                      </strong>
                      <p>{job.message}</p>
                      {job.state === "NEEDS_CHECK" && (
                        <small>
                          Jangan mengulang publikasi sebelum memeriksa akun
                          tujuan. ID: {job.externalId || "belum tersedia"}
                        </small>
                      )}
                    </div>
                    <div className="job-result">
                      <span className={"job-status " + job.state.toLowerCase()}>
                        {job.state === "SUCCEEDED" ? (
                          <CheckCheck size={14} />
                        ) : job.state === "NEEDS_CHECK" ? (
                          <TriangleAlert size={14} />
                        ) : ["QUEUED", "UPLOADING", "PROCESSING"].includes(
                            job.state,
                          ) ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : null}
                        {stateLabels[job.state] || job.state}
                      </span>
                      {job.externalUrl && (
                        <a
                          href={job.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Lihat hasil
                          <ExternalLink size={12} />
                        </a>
                      )}
                      {job.state === "FAILED" && !job.externalId && (
                        <button
                          className="button small"
                          disabled={busy === job.id}
                          onClick={() => retry(job.id)}
                        >
                          <RefreshCw size={13} />
                          Coba lagi
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
