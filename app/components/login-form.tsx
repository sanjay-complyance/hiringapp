"use client";

import { ArrowRight, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to log in");
      router.replace("/dashboard");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to log in");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="field">
        <span>Work email</span>
        <input
          data-testid="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@company.com"
          autoComplete="email"
          autoFocus
          required
        />
      </label>
      {error ? <p className="form-message error" role="alert">{error}</p> : null}
      <button className="button primary login-button" type="submit" disabled={pending}>
        <LockKeyhole size={17} />
        {pending ? "Signing in..." : "Log in"}
        <ArrowRight size={17} />
      </button>
    </form>
  );
}
