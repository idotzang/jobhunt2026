import { AddApplicationForm } from "@/features/applications/add-application-form";
import { applicationCountLabel } from "@/features/applications/count";
import { listApplications } from "@/features/applications/repository";
import { requireSession } from "@/lib/session";

export default async function Home() {
  await requireSession();
  const apps = await listApplications();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">Applications</h1>

      <AddApplicationForm today={today} />

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
