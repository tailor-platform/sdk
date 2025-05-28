#!/bin/bash
set -e

# Get all commits in first-parent order from main
echo "Collecting all commits from main..."
mapfile -t all_commits < <(git log --first-parent --reverse --format="%H" main)

FIRST_COMMIT="${all_commits[0]}"
TEMP_BRANCH="tmp"

# Clean up if the branch already exists
git branch -D "$TEMP_BRANCH" 2>/dev/null || true

echo "Creating temporary branch from first commit..."
git checkout -b "$TEMP_BRANCH" "$FIRST_COMMIT"

echo "Processing ${#all_commits[@]} commits..."

# Process each commit (skip the first one since we're already there)
for ((i=1; i<${#all_commits[@]}; i++)); do
    commit="${all_commits[i]}"

    # Check if this is a merge commit
    parent_count=$(git rev-list --parents -n 1 "$commit" | wc -w)
    parent_count=$((parent_count - 1))

    commit_short=$(git log -1 --format="%h" "$commit")
    commit_subject=$(git log -1 --format="%s" "$commit")

    if [ $parent_count -gt 1 ]; then
        # This is a merge commit - squash it
        echo "[$((i+1))/${#all_commits[@]}] Squashing merge commit: $commit_short - $commit_subject"

        # Use git read-tree to get the tree from the merge commit
        git rm -rf . --quiet 2>/dev/null || true
        git read-tree "$commit"
        git checkout-index -f -a

        # Get commit metadata
        author_name=$(git log -1 --format="%an" "$commit")
        author_email=$(git log -1 --format="%ae" "$commit")
        author_date=$(git log -1 --format="%aI" "$commit")
        committer_name=$(git log -1 --format="%cn" "$commit")
        committer_email=$(git log -1 --format="%ce" "$commit")
        committer_date=$(git log -1 --format="%cI" "$commit")
        commit_msg=$(git log -1 --format="%B" "$commit")

        # Stage all changes
        git add -A

        # Check if there are any changes to commit
        if git diff --cached --quiet; then
            echo "  No changes to commit, skipping..."
        else
            # Create a squashed commit
            LEFTHOOK=0 \
            GIT_AUTHOR_NAME="$author_name" \
            GIT_AUTHOR_EMAIL="$author_email" \
            GIT_AUTHOR_DATE="$author_date" \
            GIT_COMMITTER_NAME="$committer_name" \
            GIT_COMMITTER_EMAIL="$committer_email" \
            GIT_COMMITTER_DATE="$committer_date" \
            git commit -m "$commit_msg"
        fi
    else
        # This is a regular commit - cherry-pick it
        echo "[$((i+1))/${#all_commits[@]}] Cherry-picking: $commit_short - $commit_subject"

        # Try to cherry-pick
        if ! LEFTHOOK=0 git cherry-pick "$commit" 2>/dev/null; then
            # Check if it's because the commit is empty
            if git status | grep -q "nothing to commit"; then
                echo "  Empty commit, skipping..."
                LEFTHOOK=0 git cherry-pick --skip
            else
                # Real conflict
                echo "Error: Cherry-pick failed with conflicts for $commit"
                echo "Please resolve conflicts manually"
                exit 1
            fi
        fi
    fi
done

echo ""
echo "History rewrite complete!"
echo "New branch: $TEMP_BRANCH"
echo "Original branch: main"
echo ""
echo "Statistics:"
echo "Total commits: $(git log --oneline $TEMP_BRANCH | wc -l | tr -d ' ')"
echo "Merge commits: $(git log --oneline --merges $TEMP_BRANCH | wc -l | tr -d ' ')"
echo ""
echo "Verification (first 20 commits):"
git log --oneline "$TEMP_BRANCH" | head -20
echo ""
echo "To compare with main:"
echo "  git diff main..$TEMP_BRANCH  # Should be empty"
echo ""
echo "To apply the changes to main:"
echo "  git checkout main"
echo "  git reset --hard $TEMP_BRANCH"
echo "  git branch -D $TEMP_BRANCH"
