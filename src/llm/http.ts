export async function parseJsonResponse(response: Response, providerName: string): Promise<any> {
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`${providerName} request failed (${response.status}): ${truncate(raw, 600)}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${providerName} returned non-JSON response: ${truncate(raw, 600)}`);
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}
