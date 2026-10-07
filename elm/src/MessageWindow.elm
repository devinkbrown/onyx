module MessageWindow exposing
    ( AnchorSelection
    , MessageWindow
    , UnreadPlan
    , WindowInput
    , computeMessageWindow
    , defaultAnchorContext
    , defaultWindowSize
    , maxWindowRows
    , planUnreadNavigation
    , selectMessageAnchorIndex
    )

{-| Bounded render-window math for the message thread (mirroring
`src/shell/messageWindow.ts`).

The thread renders only a bounded contiguous slice of the full
transcript so a large channel cannot build tens of thousands of DOM
subtrees. No-anchor stays a trailing slice ending at `total`; an
anchor outside that slice (or outside an explicit historical page)
switches to a two-sided page around the anchor; an explicit page
origin renders that page unless the anchor wins or it lands on the
trailing slice (which snaps back to the live tail).

There is no show-all path. Malformed, negative, or non-finite
inputs fail closed exactly like the oracle. All numeric inputs are
`Float` (so `NaN`/`Infinity` probes behave); all outputs are `Int`.

-}

isFinite : Float -> Bool
isFinite x =
    not (isNaN x) && not (isInfinite x)


{-| Rows kept above an anchor so it does not land flush against the
window top. -}
defaultAnchorContext : Int
defaultAnchorContext =
    12


{-| Safe default (and fail-closed) render capacity. -}
defaultWindowSize : Int
defaultWindowSize =
    120


{-| Hard ceiling on rendered rows. -}
maxWindowRows : Int
maxWindowRows =
    720


{-| Window inputs: full list length, requested capacity, an optional
must-show row index, optional context above it, and an optional
explicit historical page origin. -}
type alias WindowInput =
    { total : Float
    , windowSize : Float
    , anchorIndex : Maybe Float
    , anchorContext : Maybe Float
    , pageStart : Maybe Float
    }


{-| Resolved window: rendered slice `[start, end)` plus the hidden
counts on each side. -}
type alias MessageWindow =
    { start : Int
    , end : Int
    , hiddenBefore : Int
    , hiddenAfter : Int
    , rendered : Int
    }


{-| Anchor candidates in priority order (search, landing, unread),
plus the explicit page and the one-shot unread handoff. -}
type alias AnchorSelection =
    { searchIndex : Maybe Float
    , landingIndex : Maybe Float
    , unreadIndex : Maybe Float
    , pageStart : Maybe Float
    , forceUnread : Bool
    }


{-| Bounded unread-navigation plan. -}
type alias UnreadPlan =
    { unreadIndex : Int
    , window : MessageWindow
    }


{-| Pick a single transcript anchor (first present wins; never union
disjoint ranges): active search hit, time-travel landing, then the
unread divider — in live-tail mode, or always for an explicit
unread handoff. -}
selectMessageAnchorIndex : AnchorSelection -> Maybe Int
selectMessageAnchorIndex input =
    if isValidIndex input.searchIndex then
        Maybe.map floor input.searchIndex

    else if isValidIndex input.landingIndex then
        Maybe.map floor input.landingIndex

    else if isValidIndex input.unreadIndex && (input.forceUnread || not (isFinitePageStart input.pageStart)) then
        Maybe.map floor input.unreadIndex

    else
        Nothing


{-| Resolve an explicit unread handoff before any review clear:
a bounded page containing `unreadIndex`, or `Nothing` when the
index cannot sit inside the finite render ceiling. -}
planUnreadNavigation : { total : Float, unreadIndex : Maybe Float, windowSize : Float } -> Maybe UnreadPlan
planUnreadNavigation input =
    let
        total =
            normalizeTotal input.total
    in
    case input.unreadIndex of
        Nothing ->
            Nothing

        Just raw ->
            if not (isValidIndex (Just raw)) || floor raw >= total then
                Nothing

            else
                let
                    unreadIndex =
                        floor raw

                    window =
                        computeMessageWindow
                            { total = toFloat total
                            , windowSize = input.windowSize
                            , anchorIndex = Just (toFloat unreadIndex)
                            , anchorContext = Nothing
                            , pageStart = Nothing
                            }
                in
                if unreadIndex < window.start || unreadIndex >= window.end then
                    Nothing

                else if window.rendered > maxWindowRows then
                    Nothing

                else
                    Just { unreadIndex = unreadIndex, window = window }


{-| Resolve the bounded render window for a transcript. -}
computeMessageWindow : WindowInput -> MessageWindow
computeMessageWindow input =
    let
        total =
            normalizeTotal input.total

        capacity =
            normalizeCapacity input.windowSize

        maxContext =
            max 0 (capacity - 1)

        anchorContext =
            case input.anchorContext of
                Nothing ->
                    min maxContext defaultAnchorContext

                Just raw ->
                    if isFinite raw then
                        min maxContext (max 0 (floor raw))

                    else
                        min maxContext defaultAnchorContext
    in
    if total == 0 then
        emptyWindow

    else
        let
            trailingStart =
                if total <= capacity then
                    0

                else
                    total - capacity

            paged =
                case finitePageStart input.pageStart of
                    Nothing ->
                        { start = trailingStart, end = total }

                    Just origin ->
                        pageSlice origin total capacity trailingStart

            validAnchor =
                case input.anchorIndex of
                    Nothing ->
                        Nothing

                    Just raw ->
                        if isValidIndex (Just raw) && floor raw < total then
                            Just (floor raw)

                        else
                            Nothing

            chosen =
                case validAnchor of
                    Nothing ->
                        paged

                    Just anchor ->
                        if anchor < paged.start || anchor >= paged.end then
                            twoSidedSlice anchor anchorContext total capacity

                        else
                            paged
        in
        toWindow chosen total


emptyWindow : MessageWindow
emptyWindow =
    { start = 0, end = 0, hiddenBefore = 0, hiddenAfter = 0, rendered = 0 }


toWindow : { start : Int, end : Int } -> Int -> MessageWindow
toWindow range total =
    { start = range.start
    , end = range.end
    , hiddenBefore = range.start
    , hiddenAfter = total - range.end
    , rendered = range.end - range.start
    }


normalizeTotal : Float -> Int
normalizeTotal raw =
    if isFinite raw then
        max 0 (floor raw)

    else
        0


normalizeCapacity : Float -> Int
normalizeCapacity windowSize =
    if not (isFinite windowSize) || windowSize < 1 then
        defaultWindowSize

    else
        min maxWindowRows (floor windowSize)


isValidIndex : Maybe Float -> Bool
isValidIndex value =
    case value of
        Nothing ->
            False

        Just raw ->
            isFinite raw && raw >= 0


isFinitePageStart : Maybe Float -> Bool
isFinitePageStart =
    isValidIndex


finitePageStart : Maybe Float -> Maybe Int
finitePageStart value =
    if isValidIndex value then
        Maybe.map floor value

    else
        Nothing


slice : Int -> Int -> Int -> Int -> { start : Int, end : Int }
slice start end total capacity =
    let
        s =
            max 0 (min start total)

        e =
            max s (min end total)

        capped =
            if e - s > capacity then
                { start = s, end = s + capacity }

            else
                { start = s, end = e }
    in
    if capped.end - capped.start < capacity then
        if capped.start == 0 then
            { start = capped.start, end = min total capacity }

        else if capped.end == total then
            { start = max 0 (capped.end - capacity), end = capped.end }

        else
            { start = capped.start, end = min total (capped.start + capacity) }

    else
        capped


pageSlice : Int -> Int -> Int -> Int -> { start : Int, end : Int }
pageSlice pageStart total capacity trailingStart =
    if pageStart >= trailingStart then
        { start = trailingStart, end = total }

    else
        slice pageStart (pageStart + capacity) total capacity


twoSidedSlice : Int -> Int -> Int -> Int -> { start : Int, end : Int }
twoSidedSlice anchorIndex anchorContext total capacity =
    let
        desiredStart =
            max 0 (anchorIndex - anchorContext)

        ranged =
            slice desiredStart (desiredStart + capacity) total capacity
    in
    if anchorIndex >= ranged.start && anchorIndex < ranged.end then
        ranged

    else if anchorIndex < ranged.start then
        slice anchorIndex (anchorIndex + capacity) total capacity

    else
        let
            end =
                min total (anchorIndex + 1)
        in
        slice (max 0 (end - capacity)) end total capacity
