"use client";

import en from "../../messages/en.json";
import gu from "../../messages/gu.json";
import hi from "../../messages/hi.json";
import "./globals.css";

// The root layout itself failed, so there is no language provider and the saved language
// cannot be read (its cookie is httpOnly): the message is shown in all three (M18.01).
const texts = [en.errorPage, hi.errorPage, gu.errorPage];

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  console.error(error);
  return (
    <html lang="en" translate="no">
      <body className="flex min-h-full flex-col">
        <main className="mx-auto flex w-full max-w-120 flex-1 flex-col justify-center gap-4 p-5 text-center">
          {texts.map((text) => (
            <div key={text.title}>
              <p className="text-[15px] font-bold">{text.title}</p>
              <p className="text-[15px]">{text.text}</p>
            </div>
          ))}
          <button
            type="button"
            onClick={() => retry()}
            className="min-h-11 rounded-md bg-primary px-4 font-bold text-white"
          >
            {texts.map((text) => text.retry).join(" / ")}
          </button>
        </main>
      </body>
    </html>
  );
}
