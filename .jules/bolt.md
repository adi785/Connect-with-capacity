## 2024-05-24 - PostgreSQL Subquery Filtering
**Learning:** In PostgreSQL via SQLAlchemy, aggregating full tables in subqueries and joining them before filtering (e.g., `where(Course.id.in_(course_ids))`) causes the database to perform full table scans and expensive aggregations on data that will ultimately be discarded.
**Action:** Always push down restrictive filters directly into the `subquery` definition when writing aggregate queries (like `_top_courses`), rather than applying them to the outer joined query. This pattern significantly reduces aggregation overhead on large datasets.
