"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";

export function SearchBox({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");

  function handleChange(v: string) {
    setValue(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v.trim()) params.set("q", v.trim());
    else params.delete("q");
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="search-box">
      <span className="search-box-icon">⌕</span>
      <input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}
