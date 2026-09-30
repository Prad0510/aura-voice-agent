from app.data.orders import ORDERS


def get_order_details(order_id: str):
    order = ORDERS.get(order_id.upper())

    if not order:
        return {
            "found": False,
            "message": "Order not found"
        }

    return {
        "found": True,
        "order_id": order_id.upper(),
        **order
    }