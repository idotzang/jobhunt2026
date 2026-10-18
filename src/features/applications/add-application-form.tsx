"use client";
import { useActionState } from "react";
import { addApplication } from "./actions";
import { addedBanner } from "./banner";

export function AddApplicationForm({ today }: { today: string }) {
  const [state, formAction] = useActionState(addApplication, null);

  return (
    <>
      <form action={formAction} className="grid gap-3">
        <input name="company" aria-label="Company" placeholder="Company" required className="rounded border p-2" />
        <input name="role" aria-label="Role" placeholder="Role" required className="rounded border p-2" />
        <input name="link" type="url" aria-label="Link" placeholder="Job link (optional)" className="rounded border p-2" />
        <input name="appliedOn" type="date" aria-label="Applied on" required defaultValue={today} className="rounded border p-2" />
        {state?.error && (
          <p role="alert" className="text-red-600">
            {state.error}
          </p>
        )}
        <button type="submit" className="rounded bg-black p-2 text-white">
          Add application
        </button>
      </form>
      {state?.added && (
        <p role="status" className="rounded bg-green-50 p-2 text-green-700">
          {addedBanner(state.added)}
        </p>
      )}
    </>
  );
}
