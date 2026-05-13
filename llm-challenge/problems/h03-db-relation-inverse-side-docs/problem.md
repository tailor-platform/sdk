# Name the inverse side of a many-to-one relation

## Goal

Define a `Post` TailorDB model whose `authorId` field is a many-to-one
relation toward an existing `Author` model. The relation must be configured
so that:

- the inverse side (the field that appears on `Author` records) is named
  **`posts`**, and
- the forward side (the field that appears on `Post` records when traversing
  back) is named **`author`**.

The `Author` model is already provided in the scaffold.

## Domain Context

A blog persists `Post` records that each belong to exactly one `Author`. The
frontend traverses the relation in both directions: when rendering an
author's profile it lists `author.posts`, and when rendering a single post
it deep-links via `post.author`. Wiring up only the forward direction
typechecks but leaves the platform with no inverse handle, so the frontend
cannot project from `Author` to its `Post` list.

The TailorDB relation builder exposes two distinct slots for these names:

- `toward.as` — what the inverse side is called on the **target** type
  (here: `Author`'s view, where the list of posts lives).
- `backward` — what the source side is called when navigating back from the
  target (here: how `Post` records refer to their owner).

Picking the wrong slot or omitting them silently leaves the generated schema
with no traversable handle, since both options are optional in the type.

## What to Build

The prewired `tailor.config.ts` globs `./tailordb/*.ts`. The `Author` model
is already defined in `tailordb/author.ts` and imported in the scaffold;
complete `tailordb/post.ts` so that it exports a `post` model named
`"Post"` with the fields below.

| Field    | Kind   | Notes                                                            |
| -------- | ------ | ---------------------------------------------------------------- |
| title    | string | post title                                                       |
| authorId | uuid   | many-to-one relation to `author`, inverse `posts`, back `author` |

## Requirements

- Use the relation builder available on UUID fields from `@tailor-platform/sdk`.
- The relation must be many-to-one (many posts per author).
- The relation target must be the `author` model imported from `./author`.
- The inverse-side handle (visible on the `Author` view) must be named
  `posts`.
- The source-side handle (visible on the `Post` view when traversing back to
  its owner) must be named `author`.
- Do not introduce extra fields, hooks, validators, or descriptions.

## Reference

Refer to the installed SDK package for the relation builder API, the literal
accepted by the `type` option, and the `toward.as` / `backward` slots that
configure the two navigable handle names. No external documentation is
required for this task.
