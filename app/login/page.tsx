export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="login">
      <h1>Saudi News Monitor</h1>
      {error && <div className="notice bad">Wrong password.</div>}
      <form method="post" action="/api/login">
        <input type="password" name="password" placeholder="Password" autoComplete="current-password" autoFocus required />
        <button className="primary" type="submit">Sign in</button>
      </form>
    </div>
  );
}
