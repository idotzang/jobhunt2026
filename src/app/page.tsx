import { addApplication } from "@/features/applications/actions";
import { applicationCountLabel } from "@/features/applications/count";
import { listApplications } from "@/features/applications/repository";
import { requireSession } from "@/lib/session";

export default async function Home({ searchParams }: PageProps<"/">) {
  await requireSession();
  const { error } = await searchParams;
  const message = typeof error === "string" ? error : undefined;
  const apps = await listApplications();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">Applications</h1>

      <form action={addApplication} className="grid gap-3">
        <input name="company" aria-label="Company" placeholder="Company" required className="rounded border p-2" />
        <input name="role" aria-label="Role" placeholder="Role" required className="rounded border p-2" />
        <input name="link" type="url" aria-label="Link" placeholder="Job link (optional)" className="rounded border p-2" />
        <input name="appliedOn" type="date" aria-label="Applied on" required defaultValue={today} className="rounded border p-2" />
        {message && (
          <p role="alert" className="text-red-600">
            {message}
          </p>
        )}
        <button type="submit" className="rounded bg-black p-2 text-white">
          Add application
        </button>
      </form>

      <p className="text-gray-500">{applicationCountLabel(apps.length)}</p>

      {apps.length === 0 ? (
        <p>No applications yet.</p>
      ) : (
        <ul aria-label="Applications" className="divide-y rounded border">
          {apps.map((a) => (
            <li key={a.id} className="p-3">
              <span className="font-medium">{a.company}</span> — {a.role}{" "}
              <span className="text-gray-500">({a.appliedOn})</span>
              {a.link && (
                <>
                  {" · "}
                  <a href={a.link} target="_blank" rel="noreferrer" className="underline">
                    link
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
