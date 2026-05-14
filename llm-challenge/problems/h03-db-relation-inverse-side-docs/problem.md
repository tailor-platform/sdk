# Name both sides of a many-to-one relation

## Goal

Define a `Post` TailorDB model whose `authorId` field is a many-to-one
relation toward an existing `Author` model. The relation must be configured
so that:

- the forward side (the field that appears on `Post` records traversing to
  the owning `Author`) is named **`author`**, and
- the inverse side (the field that appears on `Author` records listing the
  related posts) is named **`posts`**.

The `Author` model is already provided in the scaffold.

## Domain Context

A blog persists `Post` records that each belong to exactly one `Author`. The
frontend traverses the relation in both directions: when rendering a single
post it deep-links via `post.author`, and when rendering an author's
profile it lists `author.posts`. Wiring up only the forward direction
typechecks but leaves the platform with no inverse handle, so the frontend
cannot project from `Author` to its `Post` list.

The TailorDB relation builder exposes two distinct slots for these names:

- `toward.as` — the accessor on the **source** type that points at the
  related target record (here: how a `Post` reaches its owning `Author`).
- `backward` — the accessor on the **target** type that points back at the
  related source records (here: how an `Author` lists its `Post` records).

Picking the wrong slot or omitting them silently leaves the generated schema
with no traversable handle, since both options are optional in the type.

## What to Build

The prewired `tailor.config.ts` globs `./tailordb/*.ts`. The `Author` model
is already defined in `tailordb/author.ts` and imported in the scaffold;
complete `tailordb/post.ts` so that it exports a `post` model named
`"Post"` with the fields below.

| Field    | Kind   | Notes                                                                              |
| -------- | ------ | ---------------------------------------------------------------------------------- |
| title    | string | post title                                                                         |
| authorId | uuid   | many-to-one relation to `author`, forward `author` on Post, back `posts` on Author |

## Requirements

- Use the relation builder available on UUID fields from `@tailor-platform/sdk`.
- The relation must be many-to-one (many posts per author).
- The relation target must be the `author` model imported from `./author`.
- The forward-side handle (visible on the `Post` view when traversing to its
  owning author) must be named `author`.
- The inverse-side handle (visible on the `Author` view when listing related
  posts) must be named `posts`.
- Do not introduce extra fields, hooks, validators, or descriptions.

## Reference

Refer to the installed SDK package for the relation builder API, the literal
accepted by the `type` option, and the `toward.as` / `backward` slots that
configure the two navigable handle names. No external documentation is
required for this task.
