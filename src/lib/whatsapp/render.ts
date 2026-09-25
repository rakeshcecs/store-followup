// The message as the customer will read it (M22): a template body with its placeholders
// filled. No imports, so the browser can draw a preview too (the M23 campaign builder).
export function renderBody(body: string, variables: unknown, parameters: string[]): string {
  const names = Array.isArray(variables) ? (variables as string[]) : [];
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, number: string) => {
    const index = names.indexOf(number);
    return index >= 0 && parameters[index] !== undefined ? parameters[index]! : whole;
  });
}
