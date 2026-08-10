from anytree import Node, RenderTree
from collections import Counter
from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont
import re

from render_helpers import format_name_for_card, format_name_with_nickname, load_font
from tree_workbook import load_people_data
from project_paths import FULLBAND_DIR, required_file

PROJECT_DIR = FULLBAND_DIR

# Store generated assets beside the project instead of using machine-specific paths.
cards_dir = PROJECT_DIR / "cards"
trees_dir = PROJECT_DIR / "trees"
cards_dir.mkdir(parents=True, exist_ok=True)
trees_dir.mkdir(parents=True, exist_ok=True)

file_path = required_file("YJMB Trumpet Trees Sorted.xlsx")
# load_people_data reconstructs the historical full-name list layout from the new
# four-column Given/Preferred, Nickname, Family/Maiden, and Married Name schema.
people_data = load_people_data(file_path)

# Tree Data Making
# Dictionary to hold people by their names
people_dict = {}

# List to hold the root nodes of multiple trees
root_nodes = []

# Sets to track parents and children
parents_set = set()
children_set = set()

# List to store the individual trees as objects
family_trees = []

# Dictionary to track parent-child relationships for conflict detection
parent_child_relationships = {}

# Variable to track the current tree number
tree_number = 0

# A counter for nodes without children
end_id_counter = 1

years = []
x_max = 0

# Iterate over the people data and create nodes for each person
for i, person_info in enumerate(people_data, start=2):
    name = person_info[0]  # Name is in the first column (column A)
    rat_year = str(person_info[1])  # Year they joined the marching band (second column)
    if rat_year[:4].isdigit():
        years.append(int(rat_year[:4]))
    instrument = person_info[2]
    nickname = person_info[3]
    parent_name = person_info[7]  # Column H for VET (8th column)
    children_names = person_info[8:15]  # Columns I to N for RATs (9th to 14th columns)

    # Determine if the node has children (if any of the children_names is non-empty)
    has_children = any(child_name for child_name in children_names if child_name)

    # Skip creating nodes for people with no parent and no children
    if not parent_name and not has_children:
        continue  # Skip this person, no parent or children

    # Check if this name is already in the people_dict
    if name in people_dict:
        person_node = people_dict[name]
        # Update existing person's details
        person_node.rat_year = rat_year
        person_node.instrument = instrument
        person_node.nickname = nickname
    else:
        person_node = Node(name, tree_number=0, id=0, has_children=has_children, rat_year=rat_year, nickname=nickname, x_coord=None, y_coord=None, instrument=instrument, children_nodes=[])

        # If parent_name exists, check if the parent exists in the dictionary or needs to be created
        if parent_name:
            real_parent_name = parent_name.split(" (")[0]
            if real_parent_name in people_dict:
                parent_node = people_dict[real_parent_name]
            else:
                parent_rat_year = parent_name.split(" (")[1][:-1]
                parent_instrument = parent_name.split(" (")[2][:-1]
                parent_node = Node(real_parent_name, tree_number=0, id=0, has_children=False, rat_year=parent_rat_year, nickname=None, x_coord=None, y_coord=None, instrument=parent_instrument, children_nodes=[])
                people_dict[real_parent_name] = parent_node  # Add the parent to the dictionary
                root_nodes.append(parent_node)

            person_node.parent = parent_node  # Set the parent for the current person
            parent_node.has_children = True
            parent_node.children_nodes.append(person_node)  # Add to parent's children_nodes
        else:
            root_nodes.append(person_node)

        people_dict[name] = person_node

    # Now create child nodes for the given children names
    for child_name in children_names:
        if child_name:
            real_child_name = child_name.split(" (")[0]
            if real_child_name not in people_dict:
                if "))" in child_name:
                    child_rat_year = child_name.split(" (")[1] + child_name.split(" (")[1]
                    child_instrument = child_name.split(" (")[2][:-1]
                else:
                    child_rat_year = child_name.split(" (")[1][:-1]
                    child_instrument = child_name.split(" (")[2][:-1]
                child_node = Node(real_child_name, parent=person_node, tree_number=0, id=0, has_children=False, rat_year=child_rat_year, nickname=None, x_coord=None, y_coord=None, instrument=child_instrument, children_nodes=[])
                people_dict[real_child_name] = child_node

            person_node.has_children = True
            person_node.children_nodes.append(people_dict[real_child_name])  # Add child to parent's children_nodes

            if real_child_name not in parent_child_relationships:
                parent_child_relationships[real_child_name] = set()
            parent_child_relationships[real_child_name].add(name)

# for node in root_nodes:
#     print(node)

root_nodes.sort(key=lambda node: int(node.rat_year[:4]) if node.rat_year[:4].isdigit() else float('inf'))

# After all nodes are created, we calculate x and y coordinates for each node
new_id = 1

curr_tree = 0
old_tree = 1

min_year = min(years) if years else 0
max_year = max(years) if years else 0
year_range = max_year - min_year + 1 if years else 0

end_id_counter = 1

# Assign coordinates to nodes
for root_node in root_nodes:
    start_x_coord = 200
    curr_tree += 1
    family_tree = []
    for pre, fill, node in RenderTree(root_node):
        family_tree.append(f"{pre}{node.name}")
        node.tree_number = curr_tree
    family_trees.append(family_tree)
    for pre, fill, node in RenderTree(root_node):
        node.id = new_id
        new_id += 1
        if not node.has_children:
            new_tree = node.tree_number
            # if new_tree != old_tree:
                # start_x_coord += 200
            curr_tree = node.tree_number
            node.end_id = end_id_counter
            end_id_counter += 1
            node.x_coord = start_x_coord
            start_x_coord += 170
            old_tree = node.tree_number
        else:
            node.end_id = 0
        if getattr(node, 'x_coord', 'N/A') and getattr(node, 'x_coord', 'N/A') > x_max:
            x_max = node.x_coord

# Now assign X coordinates to nodes where X is None (based on their children)
while any(node.x_coord is None for node in people_dict.values()):
    for node in people_dict.values():
        if node.has_children:
            children_with_coords = [child for child in node.children if child.x_coord is not None]
            if len(children_with_coords) == len(node.children):  # Check if all children have x_coord
                average_x_coord = sum(child.x_coord for child in children_with_coords) / len(children_with_coords)
                node.x_coord = round(average_x_coord)

# Print out the family trees for each root node (disconnected trees)
for root_node in root_nodes:
    family_tree = []
    for pre, fill, node in RenderTree(root_node):
        family_tree.append(f"{pre}{node.name}")
    family_trees.append(family_tree)
    # print(f"\nFamily Tree starting from {root_node.name}:")
    # for pre, fill, node in RenderTree(root_node):
        # print(f"{pre}{node.name} (ID: {node.id}, Tree Number: {node.tree_number}, Has Children: {node.has_children}, End ID: {getattr(node, 'end_id', 'N/A')},  Children Nodes: {getattr(node, 'children_nodes', 'N/A')})")


# fix the rat_year attribute for even-numbered generations (done)
# use that to determine y value (done)
# determine x values from the bottom up recursively (done)




# # Print duplicate ids, if any
# if duplicates:
#     print("\nDuplicate IDs found:", duplicates)
# else:
#     print("\nNo duplicates found.")


#----------------------------------------------------------#

#----------------------------------------------------------#
# Process each root node and generate individual family tree charts
for root_node in root_nodes:
    family_years = []
    family_dict = {}
    x_max = 0
    for pre, fill, node in RenderTree(root_node):
        family_years.append(int(node.rat_year[:4]))
        family_dict[node.name] = node
        if getattr(node, 'x_coord', 'N/A') and getattr(node, 'x_coord', 'N/A') > x_max:
            x_max = node.x_coord
    # Tree Chart Making for each root node
    min_year = min(family_years) if years else 0
    max_year = max(family_years) if years else 0
    year_range = max_year - min_year + 1 if years else 0

    # Create the base image with size calculated from the maximum x-coordinate and the year range
    base_width = x_max + 200
    base_height = 180 + (100 * year_range)  # Header (240px) + layers of 100px strips based on the year range
    base_color = "#B3A369"  # Background color
    base_image = Image.new("RGB", (base_width, base_height), color=base_color)

    # Create a drawing context
    draw = ImageDraw.Draw(base_image)

    # Define the text and font for the header
    text = f"{root_node.name}'s Family Tree"
    font_size = 120  # Changed text size to 180
    font = load_font(font_size, bold=True)

    # Get the width and height of the header text
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    if text_width > base_width:
        base_width = text_width + 200
        base_image = Image.new("RGB", (base_width, base_height), color=base_color)

        # Create a drawing context
        draw = ImageDraw.Draw(base_image)

    # Calculate the position to center the header text horizontally
    x = (base_width - text_width) // 2
    y = (180 - text_height) // 2  # Vertically center the text in the 240px header area

    # Add the header text to the image
    draw.text((x, y), text, font=font, fill=(255, 255, 255))

    # List of colors for the alternating strips (background year sections)
    colors = ["#FFFFFF", "#003057", "#FFFFFF", "#B3A369"]
    strip_height = 100

    # Font for the year text
    year_font_size = 60
    year_font = load_font(year_font_size, bold=True)

    # Add the alternating colored strips beneath the header
    y_offset = 180  # Start just below the header text
    for i in range(year_range):
        strip_color = colors[i % len(colors)]  # Alternate colors for each strip

        # Draw the strip
        draw.rectangle([0, y_offset, base_width, y_offset + strip_height], fill=strip_color)

        # Calculate the text to display (the year for this strip)
        year_text = str(min_year + i)

        # Get the width and height of the year text
        bbox = draw.textbbox((0, 0), year_text, font=year_font)
        year_text_width = bbox[2] - bbox[0]
        year_text_height = bbox[3] - bbox[1]

        # Position the year text centered in the strip
        year_text_x = 25  # Offset from the left
        year_text_y = y_offset + (strip_height - year_text_height) // 2 - 5  # Vertically center

        # Determine the text color based on the strip color
        year_text_color = "#003057" if strip_color == "#FFFFFF" else "white"

        # Add the year text to the strip
        draw.text((year_text_x, year_text_y), year_text, font=year_font, fill=year_text_color)

        # Move the offset for the next strip
        y_offset += strip_height

    # Font for the names on the name cards (reduced to size 22)
    name_font_size = 22
    name_font = load_font(name_font_size)

    # Initialize counters for each year (based on the range of years)
    year_counters = {year: 0 for year in range(min_year, max_year + 1)}

    # Now, create name cards for each person and place them in the correct position
    for node in family_dict.values():
        # Choose the correct name card template based on the instrument
        if node.instrument and "Trumpet" not in node.instrument:
            name_card_template = Image.open(required_file("blank_blue_name_card.png"))
        else:
            name_card_template = Image.open(required_file("blank_name_card.png"))

        if node.rat_year:
            year_string = str(node.rat_year)[:4]
            if year_string.isdigit():
                year = int(year_string)
                year_index = year - min_year  # Find the corresponding year index (from 0 to year_range-1)


                name = format_name_for_card(node.name)

                # Create a copy of the name card for each person
                name_card_copy = name_card_template.copy()
                card_draw = ImageDraw.Draw(name_card_copy)

                # Calculate the total height of all the lines combined (with padding between lines)
                line_heights = []
                total_text_height = 0
                for line in name.split('\n'):
                    line_bbox = card_draw.textbbox((0, 0), line, font=name_font)
                    line_height = line_bbox[3] - line_bbox[1]
                    line_heights.append(line_height)
                    total_text_height += line_height

                # Shift the text up by 8 pixels and calculate the vertical starting position
                start_y = (name_card_template.height - total_text_height) // 2 - 6  # Shifted up

                # Draw each line centered horizontally
                current_y = start_y
                first_line_raised = False
                for i, line in enumerate(name.split('\n')):
                    line_bbox = card_draw.textbbox((0, 0), line, font=name_font)
                    line_width = line_bbox[2] - line_bbox[0]
                    line_x = (name_card_template.width - line_width) // 2
                    card_draw.text((line_x, current_y), line, font=name_font, fill="black")

                    if i == 0 and any(char in line for char in 'gjpqy'):
                        current_y += line_heights[i] + 7
                        first_line_raised = True
                    elif i == 0:
                        current_y += line_heights[i] + 7
                    else:
                        if first_line_raised:
                            current_y += line_heights[i] - 2
                        else:
                            current_y += line_heights[i] + (5 if i == 0 else 0)

                # Position for the name card in the appropriate year strip
                card_y = 180 + (strip_height * year_index) + (strip_height - name_card_template.height) // 2  # Centered
                node.y_coord = card_y

                # Assign card and y position attributes to each person
                person_node.card = name_card_copy
                person_node.y_coord = card_y

                # Use the counter for the corresponding year to determine x_offset
                year_counters[year] += 1
                card_file_path = os.path.join(cards_dir, f"{node.name}.png")
                person_node.card.save(card_file_path)

                # Paste the name card onto the image at the calculated position
                base_image.paste(name_card_copy, (node.x_coord, node.y_coord), name_card_copy)

    # Create a list of names from the spreadsheet, split on newlines where appropriate
    for node in family_dict.values():
        # Add black rectangle beneath the name card if the node has children
        if node.has_children:
            if len(node.children_nodes) == 1:
                child_node = getattr(node, 'children_nodes', 'N/A')[0]  # Only one child, so get the first (and only) child
                # print(getattr(child_node, 'y_coord', 'N/A'))

                # Coordinates for the rectangle (centered beneath the name card)
                rect_x = node.x_coord + (name_card_template.width - 6) // 2  # Center the rectangle
                rect_y = node.y_coord + (name_card_template.height - 2)  # Just below the name card
                rect_y_bottom = int(getattr(child_node, 'y_coord', 'N/A')) + 1  # Bottom of rectangle is aligned with the y_coord of the child

                draw.rectangle([rect_x - 1, rect_y, rect_x + 8, rect_y_bottom], fill=(111, 120, 144))
            else:
                # Calculate the leftmost and rightmost x-coordinates of the child nodes
                min_x = min(getattr(child, 'x_coord', 0) for child in node.children_nodes)
                max_x = max(getattr(child, 'x_coord', 0) for child in node.children_nodes)

                # Calculate the center of the rectangle (between the leftmost and rightmost child nodes)
                rect_x = (min_x + max_x) // 2  # Center x-coordinate between the children
                rect_y = (node.y_coord + min(getattr(child, 'y_coord', node.y_coord) for child in node.children_nodes)) // 2
                rect_width = max_x - min_x
                draw.rectangle([rect_x - rect_width // 2 + 71, rect_y + 35, rect_x + rect_width // 2 + 80, rect_y + 7 + 37], fill=(111, 120, 144))

                parent_y_bottom = rect_y + 36

                # Coordinates for the rectangle (centered beneath the name card)
                rect_x = node.x_coord + (name_card_template.width - 6) // 2  # Center the rectangle
                rect_y = node.y_coord + (name_card_template.height - 2)  # Just below the name card
                draw.rectangle([rect_x - 1, rect_y, rect_x + 8, parent_y_bottom], fill=(111, 120, 144))

                # Now create a vertical rectangle for each child node
                for child in node.children_nodes:
                    child_x = getattr(child, 'x_coord', 0)
                    child_center_x = child_x + (name_card_template.width - 6) // 2  # x-center of the child
                    child_y_bottom = parent_y_bottom  # The bottom of the rectangle should align with the parent's bottom
                    
                    # Draw the rectangle from the center of the child node up to the parent's y-bottom
                    draw.rectangle([child_center_x - 1, child_y_bottom - 1, child_center_x + 8, getattr(child, 'y_coord', 0) + 1], fill=(111, 120, 144))  # 6px wide

    # Save the final image with name cards and black rectangles for the current root node's tree

    final_image_path = os.path.join(trees_dir, f"{root_node.name}_Family_Tree_{max_year}.png")
    base_image.save(final_image_path)

    print(f"Saved {root_node.name}'s tree image")
    # base_image.show()
