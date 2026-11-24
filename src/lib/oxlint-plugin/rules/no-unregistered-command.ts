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

const COMMAND_ENTRY_POINT_METHODS = new Set([
  'registerCommand',
  'executeCommand',
]);
const VSV_RUNTIME_COMMAND_METHODS = new Set([
  'defineCommand',
  'executeCommand',
]);

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

export const noUnregisteredCommand: Rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow passing a command id that is not present in the generated CommandRegistry',
    },
    messages: {
      unregistered:
        'Command "{{id}}" is not registered in src/generated/registries.ts',
      missingRegistry:
        'No generated/registries.ts found for vsv — run `vsv dev` to generate it',
    },
    schema: [],
  },

  create: (context: RuleContext): RuleListener => {
    const registry = context.settings?.vsvCommandIds;
    return {
      CallExpression: (node: unknown): void => {
        if (!isCallExpression(node)) return;
        const callee = node.callee;
        if (!isMember(callee)) return;
        const prop = callee.property;
        if (!isIdentifier(prop)) return;
        const methodName = prop.name;
        if (
          !COMMAND_ENTRY_POINT_METHODS.has(methodName) &&
          !VSV_RUNTIME_COMMAND_METHODS.has(methodName)
        ) {
          return;
        }

        const firstArg = node.arguments[0];
        if (!isStringLiteral(firstArg)) return;
        const id = firstArg.value;
        if (typeof id !== 'string') return;

        if (registry === undefined) {
          context.report({ node: firstArg, messageId: 'missingRegistry' });
          return;
        }
        if (!registry.has(id)) {
          context.report({
            node: firstArg,
            messageId: 'unregistered',
            data: { id },
          });
        }
      },
    };
  },
};
