"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type ApiError = Error & { code?: string; body?: Record<string, unknown> };

export async function apiRequest<T = Record<string, unknown>>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options.headers }
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : "Request failed";
    const staleMessage = response.status === 409 && body.code === "STALE_VERSION"
      ? `${message}. Refresh this view to compare the latest values before trying again.`
      : message;
    const error = new Error(staleMessage) as ApiError;
    error.code = typeof body.code === "string" ? body.code : undefined;
    error.body = body;
    throw error;
  }
  return body as T;
}

export function useApiMutation() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function mutate<T>(operation: () => Promise<T>, successMessage = "Saved") {
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const result = await operation();
      setSuccess(successMessage);
      router.refresh();
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
      return null;
    } finally {
      setPending(false);
    }
  }

  return { pending, error, success, mutate, clear: () => { setError(""); setSuccess(""); } };
}

export function FormStatus({ error, success }: { error: string; success: string }) {
  if (error) return <p className="form-message error" role="alert">{error}</p>;
  if (success) return <p className="form-message success" role="status">{success}</p>;
  return null;
}

export function Modal({ trigger, title, children, size = "medium" }: { trigger: React.ReactNode; title: string; children: React.ReactNode; size?: "small" | "medium" | "large" }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <span onClick={() => ref.current?.showModal()}>{trigger}</span>
      <dialog ref={ref} className={`modal ${size}`} onClick={(event) => { if (event.target === ref.current) ref.current?.close(); }}>
        <div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={() => ref.current?.close()} aria-label="Close" title="Close"><X size={19} /></button></div>
        <div className="modal-body">{children}</div>
      </dialog>
    </>
  );
}
