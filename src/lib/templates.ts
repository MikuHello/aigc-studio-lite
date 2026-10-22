import type { Liquid } from 'liquidjs';

let enginePromise: Promise<Liquid> | null = null;

async function getEngine(): Promise<Liquid> {
  if (!enginePromise) {
    enginePromise = import('liquidjs').then(
      ({ Liquid: LiquidClass }) =>
        new LiquidClass({
          strictFilters: false,
          strictVariables: false,
          trimTagLeft: false,
          trimTagRight: false,
        }),
    );
  }
  return enginePromise;
}

export async function renderTemplate(
  template: string,
  variables: Record<string, unknown>,
): Promise<string> {
  const engine = await getEngine();
  const output = await engine.parseAndRender(template, variables);
  return output.trim();
}
