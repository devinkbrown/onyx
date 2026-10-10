module Nav exposing
    ( Id(..)
    , Item
    , Variant(..)
    , YouAction(..)
    , all
    , idKey
    , isCollection
    , items
    , label
    , reconcile
    , sectionFor
    , youActionPath
    )

{-| Shell primary navigation — port of
`src/shell/navigation/shellNavigationModel.ts` (declarative IA: Home ·
Rooms · Messages · Calls · You, one model for the desktop rail and the
mobile bottom bar) plus the Elm-only reconcile that keeps the stored
`navSection` honest when other folds move the shell (calls hub opened
from the topbar, a room picked from the rail, a call returned to).

Like the oracle, the model receives only presentation state: it never
infers connection, account, permission, encryption or active-call facts.
`You` is a transient dialog, never a current location — the stored
section is one of Home / Rooms / Messages / Calls.

-}

import Route


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
    , landmarkLabel : String
    , actionLabel : String
    , current : Bool
    , selected : Bool
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


{-| Stable key for `data-section` hooks (the oracle's id strings). -}
idKey : Id -> String
idKey id =
    String.toLower (label id)


isCollection : Id -> Bool
isCollection id =
    id == Rooms || id == Messages


{-| `createShellNavigationModel`. `expandedCollection` is `Nothing`
when the nav does not own a drawer (property absent) and `Just Nothing`
when it does but none is open; `youDialogOpen` likewise.
-}
items :
    { variant : Variant
    , current : Maybe Id
    , selectedCollection : Maybe Id
    , expandedCollection : Maybe (Maybe Id)
    , youDialogOpen : Maybe Bool
    }
    -> List Item
items input =
    let
        mobile =
            input.variant == Mobile

        build id =
            let
                collection =
                    isCollection id
            in
            { id = id
            , label = label id
            , landmarkLabel =
                if mobile then
                    "Mobile navigation"

                else
                    "Primary"
            , actionLabel =
                if mobile then
                    "Open " ++ label id

                else
                    label id
            , current = id /= You && input.current == Just id
            , selected = collection && input.selectedCollection == Just id
            , expanded =
                if collection then
                    Maybe.map (\open -> open == Just id) input.expandedCollection

                else if id == You then
                    input.youDialogOpen

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
conversation moves the location to its collection and folds the mobile
drawer away (the pick is made).
-}
reconcile :
    (String -> Bool)
    -> Maybe String
    -> { a | callsOpen : Bool, activeChannel : Maybe String, navSection : Id, navDrawerOpen : Bool }
    -> { a | callsOpen : Bool, activeChannel : Maybe String, navSection : Id, navDrawerOpen : Bool }
reconcile isChannel previousActive next =
    let
        located =
            next.activeChannel
                |> Maybe.map (sectionFor isChannel)
                |> Maybe.withDefault Home
    in
    if next.callsOpen then
        if next.navSection == Calls && not next.navDrawerOpen then
            next

        else
            { next | navSection = Calls, navDrawerOpen = False }

    else if next.activeChannel /= previousActive && next.activeChannel /= Nothing then
        { next | navSection = located, navDrawerOpen = False }

    else if next.navSection == Calls || next.navSection == You then
        { next | navSection = located }

    else
        next


{-| Destinations of the You hub (`YouSettings` / `YouHubNav`). -}
type YouAction
    = YouAccount
    | YouAppearance
    | YouGuides
    | YouAbout
    | YouStatus
    | YouLeave
    | YouPreferences


{-| Route-backed hub entries navigate in-app (`PushUrl`). -}
youActionPath : YouAction -> Maybe String
youActionPath action =
    case action of
        YouAppearance ->
            Just (Route.toPath Route.Appearance)

        YouGuides ->
            Just (Route.toPath Route.Guides)

        YouAbout ->
            Just (Route.toPath Route.About)

        YouStatus ->
            Just (Route.toPath Route.Status)

        _ ->
            Nothing
