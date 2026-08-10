from pathlib import Path
import re
from anytree import Node, RenderTree
from collections import Counter

from tree_workbook import load_people_data
from project_paths import FULLBAND_DIR, required_file

PROJECT_DIR = FULLBAND_DIR
file_path = PROJECT_DIR / "YJMB Trumpet Trees.xlsx"
# Header-aware loading keeps the historical list positions used below while the
# workbook stores names in two columns.
people_data = load_people_data(file_path, max_rats=6)

# Dictionary to hold people by their names
people_dict = {}

# List to hold the root nodes of multiple trees
root_nodes = []

# Sets to track parents and children
parents_set = set()
children_set = set()

people_not_listed_as_parents = set()
people_not_listed_as_children = set()

# Dictionary to track parent-child relationships for conflict detection
parent_child_relationships = {}

# Iterate over the people data and create nodes for each person
for i, person_info in enumerate(people_data, start=2):  # i starts at 2 for row index
    name = person_info[0]  # Assuming name is in the first column (column A)
    column_b_data = person_info[1]  # Column B data (second column)
    parent_name = person_info[7]  # Column H for parent (8th column)
    children_names = person_info[8:14]  # Columns I to N for children (9th to 14th columns)

    # Check if this name is already in the people_dict
    if name not in people_dict:
        # Create the person node (this is the current node) without column B info at this point
        person_node = Node(name)  # Create the person node with just the name

        # If parent_name is empty, this is a root node for a new tree
        if parent_name:
            if parent_name in people_dict:
                parent_node = people_dict[parent_name]
            else:
                parent_node = Node(parent_name)
                people_dict[parent_name] = parent_node  # Add the parent to the dictionary

            person_node.parent = parent_node  # Set the parent for the current person
            # Add to the parents set
            parents_set.add(parent_name)
        else:
            # If no parent is referenced, this could be the root or top-level node
            root_nodes.append(person_node)  # Add to root_nodes list

        # Store the person node in the dictionary (this ensures we don't create duplicates)
        people_dict[name] = person_node

        # Create child nodes for the person and add them to the children set
        for child_name in children_names:
            if child_name:
                # Create child node without modifying its name with additional info from the parent
                if child_name not in people_dict:
                    child_node = Node(child_name, parent=person_node)
                    people_dict[child_name] = child_node  # Store the child in the dictionary
                children_set.add(child_name)

                # Add the parent-child relationship for conflict checking
                if child_name not in parent_child_relationships:
                    parent_child_relationships[child_name] = set()
                parent_child_relationships[child_name].add(name)

# After constructing the tree structure, append column B data to each person's name
for person_info in people_data:
    name = person_info[0]  # Name in column A
    column_b_data = person_info[1]  # Column B data
    column_c_data = person_info[2]  # Column C data
    column_e_data = person_info[4]  # Column E data
    person_node = people_dict.get(name)  # Get the person's node from the dictionary

    if person_node:
        # If column C is not "Trumpet", append ({column_c_data}, {column_e_data})
        if column_c_data and column_c_data != "Trumpet":
            if column_e_data:
                person_node.name = f"{person_node.name} ({column_c_data}, {column_b_data}, {column_e_data})"
            else:
                person_node.name = f"{person_node.name} ({column_c_data}, {column_b_data})"
        elif column_e_data:
            person_node.name = f"{person_node.name} ({column_b_data}, {column_e_data})"
        # If column C is "Trumpet", retain the original format ({column_b_data})
        elif column_b_data:
            person_node.name = f"{person_node.name} ({column_b_data})"


# Print out the family trees for each root node (disconnected trees)
for root_node in root_nodes:
    print(f"\nFamily Tree starting from {root_node.name}:")
    for pre, fill, node in RenderTree(root_node):
        print(f"{pre}{node.name}")

# The rest of the conflict checking, duplicates checking, etc., remain as before

# Check for duplicate names in column A (across all rows)
names_in_column_a = [person_info[0] for person_info in people_data]

# Count occurrences of each name
name_counts = Counter(names_in_column_a)

# Find duplicates (names that appear more than once)
duplicates = {name: count for name, count in name_counts.items() if count > 1}

# Helper function to remove text in parentheses from a name
def remove_parentheses(name):
    return re.sub(r'\(.*?\)', '', name).strip()

# Updated version of the code where comparisons are done with stripped names
# Print duplicates (if any)
if duplicates:
    print("\nDuplicate names found in column A:")
    for name in duplicates:
        print(name)  # Print only the name, no occurrence count
else:
    print("\nNo duplicates found in column A.")

# # Find parents who are not listed as children
# parents_not_as_children = parents_set - children_set
# if parents_not_as_children:
#     print("\nParents who are not listed as children:")
#     for parent in parents_not_as_children:
#         print(parent)
# else:
#     print("\nAll parents are listed as children.")

# # Find children who are not listed as parents
# children_not_as_parents = children_set - parents_set
# if children_not_as_parents:
#     print("\nChildren who are not listed as parents:")
#     for child in children_not_as_parents:
#         print(child)
# else:
#     print("\nAll children are listed as parents.")

# Iterate through the rows and check if a person appears in any of columns I-N
for person_info in people_data:
    name = person_info[0]  # Name in column A
    children_names = person_info[8:14]  # Children names in columns I-N

    # Initially assume the person is not listed as a child
    is_listed_as_child = False

    # Iterate through all people in the data (columns A to N)
    for person_info in people_data:
        name = person_info[0]  # Name in column A
        is_listed_as_child = False  # Initially assume they are not listed as a child
        
        # Check if this person appears in any row in columns I-N (children columns)
        for row_info in people_data:
            children_names = row_info[8:14]  # Children names in columns I-N
            if remove_parentheses(name) in [remove_parentheses(child) for child in children_names if child]:  # If the person's name is listed as a child in this row (ignoring parentheses)
                is_listed_as_child = True
                break  # No need to check further if we've already found this person as a child in any row

    # If the person is not listed as a child in any row, add them to the set
    if not is_listed_as_child:
        people_not_listed_as_children.add(name)

# Track people who are not listed as parents
for person_info in people_data:
    name = person_info[0]  # Name in column A
    parent_name = person_info[7]  # Parent name in column H

    if not parent_name:  # If no parent is listed (i.e., root person)
        people_not_listed_as_children.add(name)  # Person is not a child

    if parent_name:
        people_not_listed_as_parents.discard(parent_name)  # Remove from not listed as parents

# # Print people not listed as children
# if people_not_listed_as_children:
#     print("\nPeople not listed as children:")
#     for person in people_not_listed_as_children:
#         print(person)
# else:
#     print("\nAll people are listed as children.")

# # Print people not listed as parents
# if people_not_listed_as_parents:
#     print("\nPeople not listed as parents:")
#     for person in people_not_listed_as_parents:
#         print(person)
# else:
#     print("\nAll people are listed as parents.")
