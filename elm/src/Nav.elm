module Nav exposing
    ( Filter(..)
    , Id(..)
    , Item
    , Variant(..)
    , all
    , allFilters
    , filterKey
    , filterLabel
    , idKey
    , isCollection
    , items
    , label
    , passesFilter
    , reconcile
    , sectionFor
    )

{-| Shell primary navigation: five destinations (Home · Rooms ·
Messages · Calls · You), one model for the desktop icon rail and the
mobile bottom bar, plus the single-select collection filter.

Ported from the v3 client (`claude/elm-port-fix-f381d5:elm/src/Nav.elm`,
itself a port of `shellNavigationModel.ts`). Adapted to today's shell:
the mobile "drawer" is the existing `clientRoomsOpen` flag (the Rooms /
Messages collection page under 768px), and the filter row (All /
Unread / @Mentions / Favorites) lives here so it stays testable without
a full `Model`.

Like the oracle, the model receives only presentation state: it never
infers connection, account, permission, encryption or active-call
facts. `You` is a transient dialog, never a current location.

-}

import Set exposing (Set)


type Id
    = Home
    | Rooms
    | Messages
    | Calls
    | You


type Variant
    = Desktop
    | Mobile


{-| One rendered destination. `expanded` / `hasPopup` stay `Nothing`
where the oracle leaves the property absent (rather than `false`).
-}
type alias Item =
    { id : Id
    , label : String
    , current : Bool
    , expanded : Maybe Bool
    , hasPopup : Maybe String
    }


{-| Canonical ordering, shared by both variants. -}
all : List Id
all =
    [ Home, Rooms, Messages, Calls, You ]


label : Id -> String
label id =
    case id of
        Home ->
            "Home"

        Rooms ->
            "Rooms"

        Messages ->
            "Messages"

        Calls ->
            "Calls"

        You ->
            "You"


{-| Stable key for `data-section` / `data-testid` hooks. -}
idKey : Id -> String
idKey id =
    String.toLower (label id)


isCollection : Id -> Bool
isCollection id =
    id == Rooms || id == Messages


{-| Both variants share destinations and state semantics. On mobile a
collection carries `aria-expanded` for its page; the You item always
announces its dialog.
-}
items :
    { variant : Variant
    , current : Id
    , collectionOpen : Bool
    , youOpen : Bool
    }
    -> List Item
items input =
    let
        build id =
            { id = id
            , label = label id
            , current = id /= You && input.current == id
            , expanded =
                if id == You then
                    Just input.youOpen

                else if isCollection id && input.variant == Mobile then
                    Just (input.collectionOpen && input.current == id)

                else
                    Nothing
            , hasPopup =
                if id == You then
                    Just "dialog"

                else
                    Nothing
            }
    in
    List.map build all


{-| The collection a conversation lives in: rooms for channel names,
messages for everything else (DMs). -}
sectionFor : (String -> Bool) -> String -> Id
sectionFor isChannel name =
    if isChannel name then
        Rooms

    else
        Messages


{-| Settle the stored section after any update: an open calls hub is
the Calls location; a closed hub stops claiming Calls; a newly active
conversation moves the location to its collection and folds the
mobile collection page away (the pick is made). `You` is never stored.
-}
reconcile :
    (String -> Bool)
    -> Maybe String
    -> { a | callsOpen : Bool, activeChannel : Maybe String, navSection : Id, clientRoomsOpen : Bool }
    -> { a | callsOpen : Bool, activeChannel : Maybe String, navSection : Id, clientRoomsOpen : Bool }
reconcile isChannel previousActive next =
    let
        located =
            next.activeChannel
                |> Maybe.map (sectionFor isChannel)
                |> Maybe.withDefault Home
    in
    if next.callsOpen then
        if next.navSection == Calls && not next.clientRoomsOpen then
            next

        else
            { next | navSection = Calls, clientRoomsOpen = False }

    else if next.activeChannel /= previousActive && next.activeChannel /= Nothing then
        { next | navSection = located, clientRoomsOpen = False }

    else if next.navSection == Calls || next.navSection == You then
        { next | navSection = located }

    else
        next



-- FILTER


{-| The sidebar's single-select filter row. -}
type Filter
    = FilterAll
    | FilterUnread
    | FilterMentions
    | FilterFavorites


allFilters : List Filter
allFilters =
    [ FilterAll, FilterUnread, FilterMentions, FilterFavorites ]


filterLabel : Filter -> String
filterLabel filter =
    case filter of
        FilterAll ->
            "All"

        FilterUnread ->
            "Unread"

        FilterMentions ->
            "@Mentions"

        FilterFavorites ->
            "Favorites"


filterKey : Filter -> String
filterKey filter =
    case filter of
        FilterAll ->
            "all"

        FilterUnread ->
            "unread"

        FilterMentions ->
            "mentions"

        FilterFavorites ->
            "favorites"


{-| Whether a conversation passes the filter. Unread counts mentions
too; favorites are the starred names (stored lowered). -}
passesFilter : Filter -> Set String -> { a | name : String, unread : Int, highlights : Int } -> Bool
passesFilter filter starred conversation =
    case filter of
        FilterAll ->
            True

        FilterUnread ->
            conversation.unread > 0 || conversation.highlights > 0

        FilterMentions ->
            conversation.highlights > 0

        FilterFavorites ->
            Set.member (String.toLower conversation.name) starred
