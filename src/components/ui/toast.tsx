"use client";

import { Toaster as Sonner, toast } from "sonner";

// Mount <Toaster /> once in the root layout; call toast("Saved") / toast.error("...") anywhere.
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      offset={88}
      mobileOffset={{ bottom: 88, left: 16, right: 16 }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-2.5 rounded-lg bg-toast px-4 py-3.5 text-[15px] font-bold text-white shadow-[0_12px_24px_-10px_rgba(0,0,0,0.4)] motion-safe:animate-in motion-safe:slide-in-from-bottom-3",
          icon: "[&_svg]:size-5",
        },
      }}
    />
  );
}

export { toast };
