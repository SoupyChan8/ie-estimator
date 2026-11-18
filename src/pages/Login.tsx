import { useState } from "react";
import { BrandMark } from "../components/BrandMark";
import { Button, Input } from "../components/ui";
import { useSession } from "../lib/session";
import styles from "./Login.module.css";

export default function Login() {
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(email.trim(), password);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden />
      <form className={styles.card} onSubmit={submit}>
        <BrandMark size="md" />
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.sub}>Studio access only. Sign in once on this iPad and you'll stay signed in.</p>
        <label className={styles.field}>
          <span>Email</span>
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className={styles.field}>
          <span>Password</span>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <p className={styles.error}>{err}</p>}
        <Button type="submit" size="lg" disabled={!email || !password || busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
