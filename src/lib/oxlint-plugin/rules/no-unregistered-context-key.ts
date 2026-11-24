import type { Rule, RuleContext, RuleListener } from '../types.ts';

interface CallExpression {
  type: 'CallExpression';
  callee: unknown;
  arguments: unknown[];
}

interface MemberExpression {
  type: 'MemberExpression';
  object: unknown;
  property: unknown;
}

interface Identifier {
  type: 'Identifier';
  name: string;
}

interface StringLiteral {
  type: 'Literal';
  value: string | number | boolean | null;
}

const CONTEXT_KEY_METHODS = new Set(['defineContextKey']);

const isObj = (node: unknown): node is Record<string, unknown> =>
  typeof node === 'object' && node !== null;

const isMember = (node: unknown): node is MemberExpression =>
  isObj(node) && node['type'] === 'MemberExpression';

const isIdentifier = (node: unknown): node is Identifier =>
  isObj(node) &&
  node['type'] === 'Identifier' &&
  typeof node['name'] === 'string';

const isStringLiteral = (node: unknown): node is StringLiteral =>
  isObj(node) &&
  node['type'] === 'Literal' &&
  typeof node['value'] === 'string';

const isCallExpression = (node: unknown): node is CallExpression =>
  isObj(node) && node['type'] === 'CallExpression';

const isSetContextCall = (call: CallExpression): boolean => {
  const callee = call.callee;
  if (!isMember(callee)) return false;
  if (!isIdentifier(callee.property)) return false;
  if (callee.property.name !== 'executeCommand') return false;
  const firstArg = call.arguments[0];
  if (!isStringLiteral(firstArg)) return false;
  return firstArg.value === 'setContext';
};

export const noUnregisteredContextKey: Rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow passing a context key name that is not present in the generated ContextKeyRegistry',
    },
    messages: {
      unregistered:
        'Context key "{{key}}" is not registered in src/generated/registries.ts',
      missingRegistry:
        'No generated/registries.ts found for vsv — run `vsv dev` to generate it',
    },
    schema: [],
  },

  create: (context: RuleContext): RuleListener => {
    const registry = context.settings?.vsvContextKeys;
    return {
      CallExpression: (node: unknown): void => {
        if (!isCallExpression(node)) return;

        let keyArg: unknown;

        if (isSetContextCall(node)) {
          keyArg = node.arguments[1];
        } else {
          const callee = node.callee;
          if (!isMember(callee)) return;
          if (!isIdentifier(callee.property)) return;
          if (!CONTEXT_KEY_METHODS.has(callee.property.name)) return;
          keyArg = node.arguments[0];
        }

        if (!isStringLiteral(keyArg)) return;
        const key = keyArg.value;
        if (typeof key !== 'string') return;

        if (registry === undefined) {
          context.report({ node: keyArg, messageId: 'missingRegistry' });
          return;
        }
        if (!registry.has(key)) {
          context.report({
            node: keyArg,
            messageId: 'unregistered',
            data: { key },
          });
        }
      },
    };
  },
};
