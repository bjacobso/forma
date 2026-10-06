; query-protocol.lisp
; -----------------------------------------------------------------------------
; Hosted QueryPlan protocol descriptors.
; -----------------------------------------------------------------------------
(type TypeNameRef {:kind "name" :name String})
(type TypeIdRef {:kind "id" :id String})
(type TypeRef (Union TypeNameRef TypeIdRef))
(type RelationshipTypeNameRef {:kind "name" :name String})
(type RelationshipTypeIdRef {:kind "id" :id String})
(type RelationshipTypeRef (Union RelationshipTypeNameRef RelationshipTypeIdRef))
(type QueryVarExpr {:kind "var" :var String})
(type QueryFieldExpr {:kind "field" :on QueryValueExpr :name String})
(type QueryLiteralExpr {:kind "lit" :value Json})
(type QueryAggregateExpr {:kind "agg" :fn AggFn :of (Option QueryValueExpr)})
(type
  QueryValueExpr
  (Union QueryVarExpr QueryFieldExpr QueryLiteralExpr QueryAggregateExpr))
(type QueryAndOrExpr {:op (Union "and" "or") :args (List QueryExpr)})
(type QueryNotExpr {:op "not" :arg QueryExpr})
(type
  QueryComparisonExpr
  {:op ComparisonOp :a QueryValueExpr :b QueryValueExpr})
(type QueryInExpr {:op "in" :a QueryValueExpr :set (List QueryValueExpr)})
(type QueryExistsExpr {:op "exists" :q SubqueryPlan})
(type
  QueryExpr
  (Union
    QueryAndOrExpr
    QueryNotExpr
    QueryComparisonExpr
    QueryInExpr
    QueryExistsExpr))
(type QueryTypeSource {:kind "type" :type TypeRef :as String})
(type QueryEntitySource {:kind "entity" :id String :as String})
(type QueryCteSource {:kind "cte" :name String :as String})
(type
  QueryViewSource
  {:kind "view" :name String :args (Map String QueryValueExpr) :as String})
(type
  QuerySource
  (Union QueryTypeSource QueryEntitySource QueryCteSource QueryViewSource))
(type QueryOneHop {:kind "one"})
(type QueryManyHop {:kind "many" :min (Option Number) :max Number})
(type QueryClosureHop {:kind "closure" :limit Number})
(type QueryHop (Union QueryOneHop QueryManyHop QueryClosureHop))
(type
  QueryJoin
  {
    :kind "link"
    :as (Option String)
    :from String
    :type RelationshipTypeRef
    :to String
    :dir (Option LinkDir)
    :optional (Option Bool)
    :hop (Option QueryHop)
    :where (Option QueryExpr)})
(type QueryObjectShape {:kind "object" :fields (Map String QueryShape)})
(type QueryPickShape {:kind "pick" :from String :fields (List String)})
(type QueryValueShape {:kind "value" :expr QueryValueExpr})
(type
  QueryListShape
  {:kind "list" :of QueryShape :limit (Option Number) :distinct (Option Bool)})
(type
  QueryShape
  (Union QueryObjectShape QueryPickShape QueryValueShape QueryListShape))
(type QueryOrder {:expr QueryValueExpr :dir SortDir :nulls (Option NullsOrder)})
(type QueryPage {:first Number :after (Option String)})
(type
  QueryOptions
  {
    :maxJoins (Option Number)
    :maxHops (Option Number)
    :maxCost (Option Number)
    :timeoutMs (Option Number)})
(type QueryDefs {:ctes (Option (Map String SubqueryPlan))})
(type
  SubqueryPlan
  {
    :v 1
    :asOf String
    :defs (Option QueryDefs)
    :from QuerySource
    :joins (Option (List QueryJoin))
    :where (Option QueryExpr)
    :groupBy (Option (List QueryValueExpr))
    :having (Option QueryExpr)
    :select QueryShape})
(type
  QueryPlan
  {
    :v 1
    :asOf String
    :defs (Option QueryDefs)
    :from QuerySource
    :joins (Option (List QueryJoin))
    :where (Option QueryExpr)
    :groupBy (Option (List QueryValueExpr))
    :having (Option QueryExpr)
    :select QueryShape
    :orderBy (Option (List QueryOrder))
    :page (Option QueryPage)
    :options (Option QueryOptions)})
(type PageInfo {:nextCursor (Option String) :hasMore Bool})
(type QueryStats {:scannedFacts (Option Number) :elapsedMs (Option Number)})
(type
  QueryResult
  {
    :asOf String
    :rows (List (Map String Json))
    :page (Option PageInfo)
    :stats (Option QueryStats)})

; Aggregate function: count, countDistinct, sum, avg, min, max
(type AggFn (Union "count" "countDistinct" "sum" "avg" "min" "max"))

; Comparison operator: eq, neq, lt, lte, gt, gte
(type ComparisonOp (Union "eq" "neq" "lt" "lte" "gt" "gte"))

; Link traversal direction: out, in, or both
(type LinkDir (Union "out" "in" "both"))

; Sort direction: ascending or descending
(type SortDir (Union "asc" "desc"))

; Where to place null values in sort order
(type NullsOrder (Union "first" "last"))
(define protocol {:name "QueryPlan"})
