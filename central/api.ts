async function rejectResponse(response: Response, url: string): Promise<never> {
  const result = await response.json();
  if (response.status === 401 && url !== "/login" && url !== "/me") {
    window.dispatchEvent(new Event("frizelo-session-expired"));
  }
  throw new Error(result.error || "Não foi possível concluir.");
}
export async function api<T>(
  url: string,
  method = "GET",
  input?: unknown,
): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    credentials: "same-origin",
    headers: input === undefined ? {} : { "Content-Type": "application/json" },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  if (!response.ok) return rejectResponse(response, url);
  return response.json();
}
export async function downloadFile(url: string, filename: string) {
  const response = await fetch(`/api${url}`, { credentials: "same-origin" });
  if (!response.ok) return rejectResponse(response, url);
  const objectURL = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectURL;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
}
