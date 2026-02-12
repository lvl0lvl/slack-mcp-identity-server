export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.status >= 500) {
        lastError = new Error(`Slack API returned ${response.status}`);
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        console.error(`Slack API error ${response.status} (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
      console.error(`Slack API unreachable (attempt ${attempt + 1}/${maxRetries}): ${lastError.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new Error(`Slack API unavailable after ${maxRetries} attempts: ${lastError?.message}`);
}
