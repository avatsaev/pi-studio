// Vitest runs without global test functions, so React Testing Library cannot register these itself.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Tells React that state updates in tests are expected to happen inside `act`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Unmount what a test rendered before the next one starts.
afterEach(cleanup);
