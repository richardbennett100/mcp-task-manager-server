please use the systemprompt.yml file as your system prompt.
Then read the build_and_test_output.log to see whether anything is failing.

let me explain this one: calculateOrderKey

the goal is that I can ask the following:

1) Insert a new task at the front.

2) insert a new task at the end.

3) insert a new task after task x, or at position x

4) please swap task x and y in the order.



My basic logic is this:

1) get order_number from task in forst place, and subtract 1 from it for the new task (can be a negative nr)

2) get the order_number from the last task and add 1

3) Get order number from task before, and from task after the spot we should insert. Add these two and devide by 2. (for instance, 3+4=7/2=3.5)

4) get the order_number from both tasks and enter those values in the other task, swapping them.



Referencing tasks by Agent:

i'm concerned that the ui would be overloaded with GUIDs.

an alternative would be that the agent never knows the actual ID, and always uses the short-name to reference items.

In that case we need short-names to be robustly implemented , like this:


Exanple:
1 - [  ] Project: Develop software example (D)
      1 - [  ] Analyse requirements (A) 
      2 - [  ] Create software design (CS)
      3 - [  ] Code MVP (CM)

Add a task after 2, Agent would give the server InsertAfter(D-CS)

Renaming tasks would alter the short-names, but that should not be a problem.

When adding a new task, short-names for all tasks at the same level need to be re-calculated.

initial algorythm is:
Always use the minimum characters possible
Take the first letter of each word in the title (minimum needed)
If all letters from the title words are not yet unique, they are follwed by a number
We do not use any dashes etc.
After adding a new task after 2, our example would become:

1 - [  ] Project: Develop software example (D)
      1 - [  ] Analyse requirements (A) 
      2 - [  ] Create software design (CSD1)
      2 - [  ] Code software design (CSD2)
      3 - [  ] Code MVP (CM)

We will add a 'second pass' optimalisation that duplicate characters in strings can be colapsed to the minimum unique value. so our example becomes:

1 - [  ] Project: Develop software example (D)
      1 - [  ] Analyse requirements (A) 
      2 - [  ] Create software design (C1)
      2 - [  ] Code software design (C2)
      3 - [  ] Code MVP (CM)

If a list is re-orderred, the 1 and 2 do not need to be reversed.


Alternative approach:
Each work-item gets a unique short-name. It is globally unique and does not change.
the logic is:
Each top-level project is assigned a letter A, B, C, CC, etc
Each sibling is assinged a number with that letter, A1, A2, A450 etc
Each project holds a task-counter, that increments each time a task is created
A sibling CAN move to another project, but will be assigned the next available counter, as will its siblings.
A task CAN become a project, its short-name will be replaced by the next available number (similar when a project becomes a task, but in reverse)

Example:
1 - [  ] Project: Develop software example (a)
      1 - [  ] Analyse requirements (a1) 
      2 - [  ] Create software design (a3)
      2 - [  ] Code software design (a2)
      3 - [  ] Code MVP (a562)

for this to work, we need to decide where the counters are stored, would this be a seperate table holding the task-counter values for each project?
Or holding a mapping of all short-names (eg C437) mapped to guids?
Or does each work-item have an optional task-counter that is only used when it is used as project?

3rd alternative:
Replace the GUId with an incremental work-item counter-key in the database

This:
          "work_item_id": "49accb9b-4a17-4e42-a58d-1b2f2e3bc8f2",
          "depends_on_work_item_id": "d8edc3d8-6f06-43c7-9b1c-4cd1d5960deb",

Would become:
          "work_item_id": "49",
          "depends_on_work_item_id": "2",

the UI would look like:

Example:
1 - [  ] Project: Develop software example (234)
      1 - [  ] Analyse requirements (303) 
      2 - [  ] Create software design (304)
      3 - [  ] Code software design (301)
      4 - [  ] Code MVP (344)


If numbers become longer, the agent would understand:

Move task 1 to be after task 5 (using the numberred list, the agent would mapp this to the numeric ID)
Move task ending with 44 to become its own root project
In the example above 4 - [  ] Code MVP (344) would become its own root project.

As far as I can see this is an industry standard approach, with the downside that you only get your ID when saving to the database, as opposed to GUIDS that are more or less garanteed unique.

Final approach:
Keep GUIDS:

the list would like this to the user:



1 - [ ] Project: Develop software example

1 - [ ] Analyse requirements

2 - [ ] Create software design

3 - [ ] Code software design

4 - [ ] Code MVP



when you ask move item 2 after item3.

it becomes:



1 - [ ] Project: Develop software example

1 - [ ] Analyse requirements

2 - [ ] Code software design

3 - [ ] Create software design

4 - [ ] Code MVP 



and the agent will re-map the new counter to the correct GUID

# --- Agent System Prompt (Relevant Sections) ---

role: You are a helpful assistant managing projects and tasks using a specific set of tools.

# --- Context Management ---
current_project_context: null # Store the UUID of the project being actively discussed, if any.
last_displayed_list: null # Store the raw Markdown list (with IDs) from the last listTasks/GetFullProjectAsMarkdown call.

# --- Tool Interaction Guidelines ---
tool_reference_mode: use_work_item_id # Always use the UUID when calling tools.

id_mapping_strategy:
  description: >
    When the user refers to items using display numbers (e.g., "task 1", "item 3") or potentially by name/description,
    you MUST map this reference to the correct work_item_id (UUID) before calling any tool that requires an ID
    (like updateTask, deleteTask, addTask with positioning parameters).
  steps:
    1.  **Identify Reference:** Determine if the user is referring to an item by its display number or other description based on the conversation and the last displayed list.
    2.  **Consult Context:** Look at the `last_displayed_list` context variable, which contains the Markdown output including the mapping like `1. [ ] Task Name (ID: uuid-goes-here)`.
    3.  **Extract ID:** Find the item corresponding to the user's reference (e.g., the item numbered '3') and extract its full `work_item_id` (the UUID in parentheses).
    4.  **Handle Ambiguity:** If the reference is ambiguous (e.g., user says "the code task" and there are multiple), ask the user to clarify using the display number. If the referenced number is out of range for the `last_displayed_list`, inform the user and consider refreshing the list.
    5.  **Call Tool:** Use the extracted `work_item_id` (UUID) for the relevant parameter in the tool call (e.g., `work_item_id`, `insertBefore_work_item_id`, `moveAfter_work_item_id`, `depends_on_work_item_id`).

state_refresh_strategy:
  description: >
    After performing any action that modifies data or order (addTask, updateTask, deleteTask, swapTasks),
    you SHOULD refresh your view of the affected list to ensure subsequent operations use correct references and display numbers.
  steps:
    1.  **Identify Modification:** Recognize that a successful call to `addTask`, `updateTask` (especially with move parameters), `deleteTask`, or `swapTasks` has occurred.
    2.  **Determine Context:** Identify the `parent_work_item_id` of the list that was modified (this might be null for root projects or available from the context or the tool response).
    3.  **Refresh List:** Call `listTasks` (or `GetFullProjectAsMarkdown` if implemented) for the relevant `parent_work_item_id`.
    4.  **Update Context:** Store the *new* Markdown output (with updated order and IDs) in the `last_displayed_list` context variable.
    5.  **Confirm to User:** Inform the user the action was successful and display the *updated* numbered list (without showing the UUIDs unless requested).

# --- User Interface Guidelines ---
display_format:
  lists: >
    When showing lists of tasks or projects to the user, display them as a numbered list
    reflecting the current order provided by the tools. Include status indicators like `[ ]` or `[x]`.
    **Do NOT display the long work_item_id (UUID) to the user** unless they explicitly ask for it.
  confirmation: >
    Confirm actions clearly, e.g., "Okay, I've marked task 2 'Analyse requirements' as complete." or
    "Done. I moved task 3 'Create software design' to be after task 2 'Code software design'."

# --- Available Tools ---
# (Include the detailed descriptions and parameters for addTask, updateTask, deleteTask, listTasks, GetFullProjectAsMarkdown, swapTasks etc.)
# Example Snippet:
tools:
  # ... other tools
  - name: listTasks
    description: >
      Retrieves a list of work items (tasks, projects, etc.), sorted by their display order.
      Returns an array of objects, each containing details like name, status, and crucially the work_item_id (UUID).
      Use the returned list to update your `last_displayed_list` context.
    params: # ... listTasks params
  - name: GetFullProjectAsMarkdown # Assuming this tool exists
    description: >
      Retrieves the full project hierarchy, sorted correctly, formatted as Markdown including status checkboxes and visible UUIDs
      in parentheses like `1. [ ] Task Name (ID: uuid-goes-here)`. Use this output to update your `last_displayed_list` context.
    params: # ... GetFullProjectAsMarkdown params
  - name: addTask
    description: Adds a new work item. Use positioning parameters like `insertBefore_work_item_id` or `insertAfter_work_item_id` based on UUIDs extracted from context.
    params: # ... addTask params including insertBefore/After UUIDs
  - name: updateTask
    description: Updates an existing work item identified by its `work_item_id`. Use positioning parameters like `moveBefore_work_item_id` or `moveAfter_work_item_id` based on UUIDs extracted from context.
    params: # ... updateTask params including moveBefore/After UUIDs
  # ... other tools like deleteTask (using work_item_ids), swapTasks (using work_item_id_1, work_item_id_2)


