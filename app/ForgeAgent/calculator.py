"""Finite basic arithmetic; no expression evaluation or code execution."""
import math
from strands import tool


@tool
def calculate(operation: str, left: float, right: float) -> dict:
    """Calculate one numeric step: add, subtract, multiply, or divide.

    For shares, subtract reserved items first, then divide the remaining amount.
    Use supplied quantities and prior calculation results; do not invent values.
    """
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in (left, right)):
        raise ValueError('Two finite numbers are required')
    operations = {'add': lambda: left + right, 'subtract': lambda: left - right,
                  'multiply': lambda: left * right, 'divide': lambda: left / right}
    if operation not in operations:
        raise ValueError('Unknown operation')
    if operation == 'divide' and right == 0:
        raise ValueError('Cannot divide by zero')
    result = operations[operation]()
    if not math.isfinite(result):
        raise ValueError('Result is not finite')
    return {'operation': operation, 'left': left, 'right': right, 'result': result}
