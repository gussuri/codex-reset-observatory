"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getDocumentLocale, type DocumentLocale as DocumentLocaleValue } from "@/lib/locale";

export function getClientDocumentLocale(pathname: string | null): DocumentLocaleValue {
  return getDocumentLocale(pathname ?? "/");
}

export function DocumentLocale() {
  const pathname = usePathname();

  useEffect(() => {
    document.documentElement.lang = getClientDocumentLocale(pathname);
  }, [pathname]);

  return null;
}
