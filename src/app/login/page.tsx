import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-4 text-2xl font-semibold">Job Hunt</h1>
      <form action={login} className="flex flex-col gap-3">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required className="rounded border p-2" />
        {error && (
          <p role="alert" className="text-red-600">
            Wrong password
          </p>
        )}
        <button type="submit" className="rounded bg-black p-2 text-white">
          Sign in
        </button>
      </form>
    </main>
  );
}
