export const dt = (
  value: string,
  opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
) =>
  new Date(value).toLocaleString("hu-HU", {
    ...opts,
    timeZone: "Europe/Budapest",
  });
export const localDate = (value?: string) => {
  const d = value ? new Date(value) : new Date(Date.now() + 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export const err = (e: unknown) =>
  e instanceof Error ? e.message : "Váratlan hiba történt.";
export const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("");
export function exportCsv(name: string, rows: (string | number)[][]) {
  const csv =
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              String(v)
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(";"),
      )
      .join("\r\n");
  const a = document.createElement("a"),
    url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
