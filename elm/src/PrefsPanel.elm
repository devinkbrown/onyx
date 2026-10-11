module PrefsPanel exposing
    ( Category(..)
    , CategoryInfo
    , Status
    , categories
    , categoryAfterKey
    , categoryId
    , categoryInfo
    , countLabel
    , discardedQueuedCopy
    , hidesEvent
    , isRoomDraftTarget
    , queuedCountChangedCopy
    , queuedDiscardFailedCopy
    , queuedKeptCopy
    , roomDrafts
    , roomDraftsDiscardedCopy
    , roomDraftsKeptCopy
    , segmentAfterKey
    , vaultSearchModeLabels
    )

{-| Device Preferences sheet — pure helpers (oracle
`src/shell/PreferencesPanel.tsx`).

The sheet itself lives in `View.Prefs`; the state folds live in the
`-- v3/prefs` blocks of `App`. This module holds only the category
table + tab-list keyboard model, the count/copy builders, the room-draft
projection, and the system-event visibility predicate, so each is
testable without a `Model`.

-}

import Dict exposing (Dict)


{-| Preference categories ported from `PREFERENCE_CATEGORIES`
(narrowed: `App & tools` is not ported — no PWA/extension surfaces in
the Elm client yet).
-}
type Category
    = Display
    | Conversation
    | Privacy
    | History
    | Transfer
    | Accessibility


type alias CategoryInfo =
    { category : Category
    , id : String
    , label : String
    , summary : String
    }


{-| Inline status line for the destructive cards (`role="status"`, or
`role="alert"` when `failure`).
-}
type alias Status =
    { message : String
    , failure : Bool
    }


categories : List CategoryInfo
categories =
    [ { category = Display, id = "display", label = "Display", summary = "Reading and rhythm" }
    , { category = Conversation, id = "conversation", label = "Conversation", summary = "Room surfaces" }
    , { category = Privacy, id = "privacy", label = "Privacy", summary = "Who can reach you" }
    , { category = History, id = "history", label = "History & data", summary = "Local vault" }
    , { category = Transfer, id = "transfer", label = "Import & export", summary = "Move conversation data" }
    , { category = Accessibility, id = "accessibility", label = "Accessibility", summary = "Motion and access" }
    ]


categoryInfo : Category -> CategoryInfo
categoryInfo category =
    categories
        |> List.filter (\info -> info.category == category)
        |> List.head
        |> Maybe.withDefault { category = Display, id = "display", label = "Display", summary = "Reading and rhythm" }


categoryId : Category -> String
categoryId category =
    (categoryInfo category).id


{-| Tab-list navigation (mirroring `PreferenceCategoryNavigation`'s
`onKeyDown` on the vertical desktop tablist, which also accepts the
horizontal arrows on narrow screens): Down/Right step forward, Up/Left
step back, both wrap; Home/End jump to the ends. Other keys return
`Nothing` so the view does not claim them.
-}
categoryAfterKey : Category -> String -> Maybe Category
categoryAfterKey current key =
    let
        order =
            List.map .category categories

        count =
            List.length order

        index =
            indexOf current order |> Maybe.withDefault 0

        at i =
            List.drop (modBy count i) order |> List.head
    in
    case key of
        "ArrowDown" ->
            at (index + 1)

        "ArrowRight" ->
            at (index + 1)

        "ArrowUp" ->
            at (index - 1)

        "ArrowLeft" ->
            at (index - 1)

        "Home" ->
            List.head order

        "End" ->
            List.reverse order |> List.head

        _ ->
            Nothing


{-| Segmented radio-group navigation (mirroring `Segmented`'s
`onKeyDown`): Right/Down next, Left/Up previous (wrapping), Home/End to
the ends. A current value outside `options` starts from the first.
-}
segmentAfterKey : List String -> String -> String -> Maybe String
segmentAfterKey options current key =
    let
        count =
            List.length options

        index =
            indexOf current options |> Maybe.withDefault 0

        at i =
            if count == 0 then
                Nothing

            else
                List.drop (modBy count i) options |> List.head
    in
    case key of
        "ArrowRight" ->
            at (index + 1)

        "ArrowDown" ->
            at (index + 1)

        "ArrowLeft" ->
            at (index - 1)

        "ArrowUp" ->
            at (index - 1)

        "Home" ->
            List.head options

        "End" ->
            List.reverse options |> List.head

        _ ->
            Nothing


indexOf : a -> List a -> Maybe Int
indexOf needle list =
    list
        |> List.indexedMap Tuple.pair
        |> List.filter (\( _, item ) -> item == needle)
        |> List.head
        |> Maybe.map Tuple.first


{-| `countLabel(n, noun)` — `1 queued send`, `2 queued sends`. -}
countLabel : Int -> String -> String
countLabel n noun =
    String.fromInt n
        ++ " "
        ++ noun
        ++ (if n == 1 then
                ""

            else
                "s"
           )


{-| Vault search mode radio labels in oracle order (`hybrid`, `exact`,
`semantic` — `VAULT_SEARCH_MODE_LABELS`).
-}
vaultSearchModeLabels : List ( String, String )
vaultSearchModeLabels =
    [ ( "hybrid", "Text + related" )
    , ( "exact", "Exact" )
    , ( "semantic", "Related terms" )
    ]


{-| Room composer drafts are the `#`/`&` targets (mirroring the oracle's
`readLocalDraftSnapshot`: direct-message drafts are never counted or
discarded here).
-}
isRoomDraftTarget : String -> Bool
isRoomDraftTarget target =
    String.startsWith "#" target || String.startsWith "&" target


{-| Non-empty room drafts keyed by lower-cased target, sorted. `active`
is the live composer for the open conversation (its draft is only
stashed in the dict when the user switches away), merged over the
stored copy.
-}
roomDrafts : Maybe ( String, String ) -> Dict String String -> List ( String, String )
roomDrafts active stored =
    let
        withActive =
            case active of
                Just ( target, text ) ->
                    if String.isEmpty (String.trim text) then
                        Dict.remove (String.toLower target) stored

                    else
                        Dict.insert (String.toLower target) text stored

                Nothing ->
                    stored
    in
    withActive
        |> Dict.toList
        |> List.filter (\( target, text ) -> isRoomDraftTarget target && not (String.isEmpty (String.trim text)))


{-| `Hide join, part & quit` hides exactly those three system rows
(narrowed from the oracle's CSS, which hides every system row).
-}
hidesEvent : Bool -> String -> Bool
hidesEvent hideEvents msgType =
    hideEvents && List.member msgType [ "join", "part", "quit" ]


queuedKeptCopy : String
queuedKeptCopy =
    "Queued sends kept on this device."


queuedCountChangedCopy : Int -> String
queuedCountChangedCopy current =
    "Queued send count changed to " ++ String.fromInt current ++ ". Review the updated count and confirm again."


queuedDiscardFailedCopy : String
queuedDiscardFailedCopy =
    "Could not verify that all queued sends were discarded. The confirmation remains open; nothing will be reported as removed until device storage confirms it."


discardedQueuedCopy : Int -> String
discardedQueuedCopy n =
    "Discarded " ++ countLabel n "queued send" ++ ". Their unsent message text was removed from this device and will not be sent."


roomDraftsKeptCopy : String
roomDraftsKeptCopy =
    "Local drafts kept on this device."


roomDraftsDiscardedCopy : Int -> String
roomDraftsDiscardedCopy n =
    "Discarded " ++ countLabel n "room draft" ++ " from this device. Direct-message drafts were not changed."
