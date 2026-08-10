from project_paths import generated_path, required_file
from sort_tree_workbook import sort_workbook

if __name__ == "__main__":
    sort_workbook(
        required_file("YJMB Baritone Trees Updated.xlsx"),
        generated_path("YJMB Baritone Trees Sorted.xlsx"),
    )
