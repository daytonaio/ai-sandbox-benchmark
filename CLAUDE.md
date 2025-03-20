# AI Sandbox Benchmark Commands & Style Guide

## Commands
- Run interactive TUI: `python benchmark.py`
- Run CLI benchmark: `python comparator.py`
- Run specific tests: `python comparator.py --tests 1,2 --providers daytona,e2b`
- Run single test: `python comparator.py --tests 1 --providers daytona`
- Run on local machine: `python comparator.py --providers local`
- Adjust runs: `python comparator.py --runs 5 --warmup-runs 2`
- Change region: `python comparator.py --target-region us`
- Show history: `python comparator.py --show-history`
- Custom history: `python comparator.py --history-file custom_history.json --show-history`

## Testing Setup
- Start CodeSandbox service first: `cd providers && node codesandbox-service.js`
- Ensure environment variables are set in .env file (not needed when using only the local provider)
- Some tests will run only once regardless of `--runs` parameter (those with `single_run = True` property)
- Configure sandbox settings in `config.yml`

## Available Tests
1. Calculate Primes - Basic prime numbers calculation
2. Improved Calculate Primes - Optimized version
3. Resource Intensive Calculation - Stress test
4. Package Installation - Package installation timing
5. File I/O Performance - File operations benchmark
6. Startup Time - Python interpreter startup
7. LLM Generated Primes - Using LLM to generate code
8. Database Operations - SQLite performance
9. Container Stability - Stability under load
10. List Directory - Basic system command test
11. System Info - Environment information
12. FFT Performance - Fast Fourier Transform test
13. FFT Multiprocessing - Parallel processing test
14. Optimized Example - Optimized execution patterns
15. Sandbox Utils - Sandbox utility functions
16. Template - Template for new tests

## Code Style
- Imports: standard library first, then third-party, then local imports
- Type hints: Use Python typing module for all functions and classes
- Error handling: Use try/except blocks with specific exceptions
- Naming: snake_case for functions/variables, CamelCase for classes
- Async: Use asyncio for concurrent operations
- Documentation: Use docstrings for all public functions and classes

## Providers Implementation
- All provider modules must implement an `execute(code, ...)` function
- Always properly handle resource cleanup in finally blocks
- Parallel provider testing: tests run simultaneously across providers