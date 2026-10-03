import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'readme_da_vaga/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      curly: ['error', 'all'],
    },
  },
];
