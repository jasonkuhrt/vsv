export interface RuleMeta {
  type: 'problem' | 'suggestion' | 'layout';
  docs: { description: string; recommended?: boolean };
  messages: Record<string, string>;
  schema: unknown[];
}

export interface RuleContext {
  report: (descriptor: {
    node: unknown;
    messageId: string;
    data?: Record<string, string>;
  }) => void;
  settings?: {
    vsvCommandIds?: ReadonlySet<string>;
    vsvContextKeys?: ReadonlySet<string>;
  };
}

export interface RuleListener {
  CallExpression?: (node: unknown) => void;
}

export interface Rule {
  meta: RuleMeta;
  create: (context: RuleContext) => RuleListener;
}
