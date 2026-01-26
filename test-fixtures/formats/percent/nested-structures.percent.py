# %%
class MyClass:
    def method(self):
        print("nested")
    def other(self):
        if True:
            print("deeply nested")

obj = MyClass()
