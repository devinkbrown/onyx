module RosterWindow exposing
    ( Limits
    , Window
    , initialRows
    , limitFor
    , rowId
    , step
    , window
    )

{-| v3/gap-people — paint big member lists a window at a time.

Rooms hold up to 4,096 people. Rendering every row made each update
re-diff thousands of nodes (typing in a 4,000-person room cost ~190 ms
a keystroke). Each roster group now paints its first `initialRows`
rows and ends with a "Show more" button that adds `step` rows; the
section headings keep the real counts, collapsible groups (Away)
stay native disclosures, and the filter still searches everyone.
Limits are per group and reset when the room or the filter changes.

-}

import Dict exposing (Dict)


type alias Limits =
    Dict String Int


initialRows : Int
initialRows =
    120


step : Int
step =
    300


limitFor : String -> Limits -> Int
limitFor key limits =
    Dict.get key limits |> Maybe.withDefault initialRows |> max initialRows


{-| One group's painted rows plus how many stay unpainted. -}
type alias Window a =
    { shown : List a
    , total : Int
    , hidden : Int
    }


window : Int -> List a -> Window a
window limit rows =
    let
        total =
            List.length rows

        shown =
            List.take limit rows
    in
    { shown = shown, total = total, hidden = max 0 (total - limit) }


{-| DOM id of a row's main button, so "Show more" can move focus to
the first newly painted row. -}
rowId : String -> Int -> String
rowId groupKey index =
    "onyx-mrow-" ++ groupKey ++ "-" ++ String.fromInt index
