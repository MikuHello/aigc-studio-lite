import parser from '@typescript-eslint/parser';
import { allowsComment } from './scripts/comment-policy.mjs';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.wrangler*/**', '.codex/**', 'coverage/**'] },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,jsx}'],
    languageOptions: { parser, ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    plugins: {
      project: {
        rules: {
          'necessary-comments': {
            meta: {
              type: 'suggestion',
              schema: [],
              messages: {
                forbidden:
                  'Remove this comment or explain a necessary @reason, @compat or @license constraint.',
              },
            },
            create(context) {
              return {
                Program() {
                  for (const comment of context.sourceCode.getAllComments()) {
                    if (!allowsComment(comment.value)) {
                      context.report({ loc: comment.loc, messageId: 'forbidden' });
                    }
                  }
                },
              };
            },
          },
        },
      },
    },
    rules: {
      'project/necessary-comments': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-debugger': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-duplicate-case': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unreachable': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
