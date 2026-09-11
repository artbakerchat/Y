# Forge Evals

These offline checks make deterministic agent contracts measurable without
calling a model or spending inference credits.

Run them from the repository root:

```bash
PYTHONPATH=evals python3 -m unittest discover -s evals -p 'test_*.py'
```

`score_output` checks required and forbidden response fragments. `score_trajectory`
checks that required tool calls appear in order while allowing unrelated calls
between them. For production quality, add the Module 7 `strands-agents-evals`
package and pair these contracts with `OutputEvaluator` and `TrajectoryEvaluator`.

`forge_trajectory.py` adds the current application's contracts: palette reads
before suggestions, focused searches before suggestions, and delegation through
`consult_word_specialist`. Pass recorded Bedrock or Strands messages to
`evaluate_all_forge_trajectories`; no AWS call is made by the evaluator. These
contracts check the observable outer Worker trace. The specialist's internal
tool loop remains a separate model trace because the Worker currently returns
its final specialist result as one outer tool result.
