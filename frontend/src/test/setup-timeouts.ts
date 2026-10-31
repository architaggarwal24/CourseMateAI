import { configure } from "@testing-library/react";

// findBy* / waitFor give the UI up to 3 s (default 1 s): a loaded laptop running the whole suite in parallel can take
// longer than a second to settle an animated screen, and that is not a bug in the screen.
configure({ asyncUtilTimeout: 3000 });
