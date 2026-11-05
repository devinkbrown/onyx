module NotificationRoute exposing (AllowedRoute, Msg(..), RouteKind(..), update)

{-| Validated public route descriptions. No payload URL or message preview is
accepted as a navigation command.
-}

type RouteKind
    = DirectMessage
    | Mention
    | Call
    | Inbox


type alias AllowedRoute =
    { networkId : String
    , ownerRef : Maybe String
    , kind : RouteKind
    , conversationId : Maybe String
    }


type Msg
    = RouteReceived AllowedRoute
    | RouteOpened
    | RouteRejected String


update : Msg -> Maybe AllowedRoute -> Maybe AllowedRoute
update msg current =
    case msg of
        RouteReceived route ->
            if String.isEmpty route.networkId || (route.kind /= Inbox && route.conversationId == Nothing) then
                Nothing

            else
                Just route

        RouteOpened ->
            Nothing

        RouteRejected _ ->
            current
