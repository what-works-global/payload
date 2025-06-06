# Manual Join Mode Implementation Plan

This package currently uses MongoDB `$lookup` stages with `let` and `pipeline` to resolve join fields and to sort by relationship fields. Examples can be seen in `buildJoinAggregation.ts` and `buildSortParam.ts`:

```
$lookup: {
  as: alias,
  from: JoinModel.collection.name,
  let: { root_id_: '$_id' },
  pipeline: [ ... ]
}
```

```
$lookup: {
  as: `__${path}`,
  foreignField: '_id',
  from: foreignCollection.Model.collection.name,
  localField: versions ? `version.${relationshipPath}` : relationshipPath,
  pipeline: [ { $project: { [sortFieldPath]: true } } ]
}
```

Firestore's MongoDB compatibility layer does not support these features, so join logic must be moved outside of the aggregation pipeline.

## 1. Add configuration flag

Introduce a `manualJoins` boolean option when creating the adapter (e.g., `mongooseAdapter({ manualJoins: true })`). Store this flag in the adapter instance so other modules can check it.

## 2. Skip `$lookup` aggregation

Modify `buildJoinAggregation` to return `undefined` when `manualJoins` is true. Instead of pushing `$lookup` stages, collect metadata describing each join (collection slug, relation field, filters, sort options, limits, etc.) so it can be resolved later in application code.

## 3. Resolve joins in Node.js

Create `utilities/resolveJoins.ts` that accepts the documents returned from the initial query and the join metadata. For each join:

1. Gather all parent IDs and query the related collection using `Model.find` (or `Model.find({ on: { $in: ids } })`).
2. Apply `where` conditions using existing query builders.
3. Sort and limit results in JavaScript (or with Mongo queries where possible).
4. Attach the resulting docs to the parent objects, along with `hasNextPage` and `totalDocs` values.

### Possible approaches

- **Bulk fetch** all related docs for a join using `$in` to avoid an N+1 query problem.
- **Populate** using Mongoose's built‑in `populate` method with `lean: true`.
- **Per-document queries** for the simplest implementation (may be slower for many parents).

## 4. Update find operations

In `find.ts`, `findOne.ts`, and similar query functions, when `manualJoins` is enabled:

- Run the normal `Model.paginate` or `Model.find` query without join aggregations.
- After the base documents are returned, call `resolveJoins` to fetch and attach related data.

## 5. Sorting by relationship fields

`buildSortParam.ts` currently inserts a `$lookup` stage so that MongoDB can sort on a relationship field. When `manualJoins` is true:

1. Do not push this `$lookup` stage.
2. Record which relationship paths require sorting.
3. After `resolveJoins`, compute sort keys for each document and perform the sorting in Node.

### Options for sorting

- **Bulk mapping**: query the related collection once to get a map of `_id` to sort values, then sort the parent docs in JavaScript.
- **Per-document**: fetch the sort value during join resolution and sort afterward.
- **External index**: maintain a separate collection or Firestore index that stores the sortable field values.

## 6. Counting join documents

For joins that request `totalDocs`, use `countDocuments` queries in `resolveJoins`. Alternatively, run a small aggregation with `$group` to compute counts for all parent IDs in one request.

## 7. Tests and documentation

- Add tests ensuring manual join mode returns the same data structure as the current aggregation approach.
- Document the new `manualJoins` option in `README.md` with examples and limitations (additional round trips, potential performance impact).

---

This plan enables the `db-mongodb` adapter to operate on Firestore's MongoDB compatibility layer by removing reliance on `$lookup` pipelines and resolving joins in application code.

## Concerns

- **Performance**: without `$lookup` a large number of additional queries may be required. Care must be taken to bulk fetch related docs to avoid an N+1 problem.
- **Parity with aggregation logic**: the current pipeline handles localization, polymorphic joins, `hasNextPage`, `totalDocs`, and drafts/versions. Re‑implementing these features in Node will be complex and easy to get wrong.
- **Sorting**: reproducing `$sortArray` and the existing sort behavior in JavaScript may lead to different ordering if locale-specific collations or compound sort keys are used.
- **Counting docs**: `$count` in the pipeline is efficient. Running individual `countDocuments` queries could be slower and require additional logic for draft versions.
- **Pipeline operators**: other stages in `aggregatePaginate.ts` (e.g., `$sort`, `$skip`, `$limit`) are still used even when joins are disabled. Firestore must support these operators, otherwise additional fallbacks will be required.
